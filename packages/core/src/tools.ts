import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Type } from "./llm.js";
import type { ScorelTool, ScorelToolResult } from "./types.js";

const DEFAULT_MAX_BYTES = 64_000;
const DEFAULT_MAX_RESULTS = 200;

export type ReadonlyToolsOptions = {
  cwd?: string;
  maxBytes?: number;
  maxResults?: number;
};

export function createReadonlyTools(options: ReadonlyToolsOptions = {}): ScorelTool[] {
  const cwd = resolve(options.cwd ?? process.cwd());
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  return [
    {
      name: "read",
      label: "Read",
      description: "Read a UTF-8 text file inside the current workspace. Supports 1-based line offset and line limit.",
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number())
      }),
      executionMode: "parallel",
      execute: async ({ args, signal }) => {
        try {
          signal.throwIfAborted();
          const path = resolveInside(cwd, stringArg(args.path, "path"));
          const text = await readFile(path, "utf8");
          const lines = text.split(/(?<=\n)/);
          const offset = positiveInteger(args.offset, 1);
          const limit = positiveInteger(args.limit, lines.length);
          const sliced = lines.slice(offset - 1, offset - 1 + limit).join("");
          const content = truncate(sliced, maxBytes);
          return ok(content.text, {
            path,
            offset,
            limit,
            truncated: content.truncated || offset - 1 + limit < lines.length,
            size: text.length
          });
        } catch (error) {
          return failure(error);
        }
      }
    },
    {
      name: "ls",
      label: "List",
      description: "List files and directories inside the current workspace.",
      parameters: Type.Object({
        path: Type.Optional(Type.String())
      }),
      executionMode: "parallel",
      execute: async ({ args, signal }) => {
        try {
          signal.throwIfAborted();
          const path = resolveInside(cwd, typeof args.path === "string" ? args.path : ".");
          const entries = await readdir(path, { withFileTypes: true });
          const rows = entries
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, maxResults)
            .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
            .join("\n");
          return ok(rows.length > 0 ? `${rows}\n` : "", {
            path,
            count: entries.length,
            truncated: entries.length > maxResults
          });
        } catch (error) {
          return failure(error);
        }
      }
    },
    {
      name: "glob",
      label: "Glob",
      description: "Find workspace files by a simple glob pattern such as *.ts, **/*.md, or src/**/*.test.ts.",
      parameters: Type.Object({
        pattern: Type.String()
      }),
      executionMode: "parallel",
      execute: async ({ args, signal }) => {
        try {
          signal.throwIfAborted();
          const pattern = stringArg(args.pattern, "pattern");
          const matches: string[] = [];
          const matcher = globToRegExp(pattern);
          for await (const file of walkFiles(cwd, signal)) {
            const rel = normalizePath(relative(cwd, file));
            if (matcher.test(rel)) {
              matches.push(rel);
              if (matches.length >= maxResults) {
                break;
              }
            }
          }
          return ok(matches.length > 0 ? `${matches.join("\n")}\n` : "", {
            pattern,
            count: matches.length,
            truncated: matches.length >= maxResults
          });
        } catch (error) {
          return failure(error);
        }
      }
    },
    {
      name: "grep",
      label: "Grep",
      description: "Search UTF-8 text files in the current workspace and return path:line:match rows.",
      parameters: Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String())
      }),
      executionMode: "parallel",
      execute: async ({ args, signal }) => {
        try {
          signal.throwIfAborted();
          const pattern = stringArg(args.pattern, "pattern");
          const root = resolveInside(cwd, typeof args.path === "string" ? args.path : ".");
          const re = new RegExp(pattern, "i");
          const rows: string[] = [];
          const rootStat = await stat(root);
          const files = rootStat.isDirectory() ? walkFiles(root, signal) : [root];
          for await (const file of files) {
            if (isProbablyBinary(file)) {
              continue;
            }
            let lineNumber = 0;
            const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
            for await (const line of rl) {
              signal.throwIfAborted();
              lineNumber += 1;
              if (re.test(line)) {
                rows.push(`${normalizePath(relative(cwd, file))}:${lineNumber}:${line}`);
                if (rows.length >= maxResults) {
                  rl.close();
                  break;
                }
              }
            }
            if (rows.length >= maxResults) {
              break;
            }
          }
          return ok(rows.length > 0 ? `${rows.join("\n")}\n` : "", {
            pattern,
            path: root,
            count: rows.length,
            truncated: rows.length >= maxResults
          });
        } catch (error) {
          return failure(error);
        }
      }
    }
  ];
}

function ok(text: string, details: Record<string, unknown>): ScorelToolResult {
  return { content: [{ type: "text", text }], details, isError: false };
}

function failure(error: unknown): ScorelToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
}

function resolveInside(cwd: string, path: string): string {
  const resolved = resolve(cwd, path);
  const rel = relative(cwd, resolved);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return resolved;
  }
  throw new Error(`Path is outside cwd: ${path}`);
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: `${Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")}\n[truncated]\n`, truncated: true };
}

async function* walkFiles(root: string, signal: AbortSignal): AsyncGenerator<string> {
  signal.throwIfAborted();
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(path, signal);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function isProbablyBinary(path: string): boolean {
  const name = basename(path);
  if (name === "pnpm-lock.yaml") {
    return false;
  }
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".gz", ".wasm"].includes(extname(path).toLowerCase());
}
