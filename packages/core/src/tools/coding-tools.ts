import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { AgentTool, ToolResult } from "./index.js";
import { defineTool } from "./index.js";

const execFileAsync = promisify(execFile);

export type CodingToolsOptions = {
  cwd: string;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
};

type FileReadSnapshot = {
  hash: string;
  mtimeMs: number;
  size: number;
};

type CodingToolsState = {
  reads: Map<string, FileReadSnapshot>;
  todos: TodoItem[];
};

type ReadArgs = {
  path: string;
  offset?: number;
  limit?: number;
};

type WriteArgs = {
  path: string;
  content: string;
  createParents?: boolean;
};

type EditArgs = {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

type BashArgs = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type GlobArgs = {
  pattern: string;
  cwd?: string;
  maxResults?: number;
};

type GrepArgs = {
  pattern: string;
  cwd?: string;
  glob?: string;
  outputMode?: "files_with_matches" | "content" | "count";
  maxResults?: number;
  maxOutputBytes?: number;
};

type GrepMatch = {
  path: string;
  line: number;
  text: string;
};

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

type TodoArgs = {
  todos: TodoItem[];
};

export const createCodingTools = (options: CodingToolsOptions): AgentTool[] => {
  const root = resolve(options.cwd);
  const state: CodingToolsState = { reads: new Map(), todos: [] };
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  const maxTimeoutMs = options.maxTimeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 16_000;

  const resolveWorkspacePath = (input: string): string => {
    if (input.length === 0) {
      throw new Error("path must not be empty");
    }
    const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input);
    if (!isWithin(root, candidate)) {
      throw new Error(`path escapes workspace: ${input}`);
    }
    return candidate;
  };

  const assertFreshRead = async (path: string, toolName: string): Promise<void> => {
    const snapshot = state.reads.get(path);
    if (!snapshot) {
      throw new Error(`Read must be used before ${toolName} on existing file: ${path}`);
    }
    const current = await snapshotFile(path);
    if (!sameSnapshot(snapshot, current)) {
      throw new Error(`File changed since last Read: ${path}`);
    }
  };

  return [
    defineTool({
      name: "Read",
      description: "Read a file from the local filesystem with stable 1-based line numbers.",
      execute: async (_toolCallId, args) => {
        const input = parseReadArgs(args);
        const path = resolveWorkspacePath(input.path);
        const fileStat = await stat(path);
        if (fileStat.isDirectory()) {
          throw new Error(`Read cannot read a directory: ${input.path}`);
        }

        const content = await readFile(path, "utf8");
        state.reads.set(path, await snapshotFile(path, content));
        const lines = content.split(/\r?\n/);
        if (lines.at(-1) === "") {
          lines.pop();
        }

        const offset = input.offset ?? 1;
        const limit = input.limit ?? lines.length;
        if (!Number.isInteger(offset) || offset < 1) {
          throw new Error("offset must be a positive integer");
        }
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("limit must be a positive integer");
        }

        const startIndex = offset - 1;
        const selected = lines.slice(startIndex, startIndex + limit);
        const text = selected.map((line, index) => `${String(offset + index).padStart(6, " ")}\t${line}`).join("\n");
        const endLine = selected.length === 0 ? offset - 1 : offset + selected.length - 1;

        return {
          content: [{ type: "text", text }],
          details: {
            path,
            startLine: offset,
            endLine,
            totalLines: lines.length,
            size: fileStat.size,
          },
        };
      },
    }),
    defineTool({
      name: "Write",
      description: "Create a new file or fully rewrite a file. Existing files must be read first.",
      execute: async (_toolCallId, args) => {
        const input = parseWriteArgs(args);
        const path = resolveWorkspacePath(input.path);
        if (await exists(path)) {
          await assertFreshRead(path, "Write");
        } else if (input.createParents) {
          await mkdir(dirname(path), { recursive: true });
        }

        await writeFile(path, input.content, "utf8");
        state.reads.set(path, await snapshotFile(path, input.content));
        return textResult(`wrote ${byteLength(input.content)} bytes to ${path}`, { path, bytes: byteLength(input.content) });
      },
    }),
    defineTool({
      name: "Edit",
      description: "Perform exact string replacement in a file. Existing files must be read first.",
      execute: async (_toolCallId, args) => {
        const input = parseEditArgs(args);
        const path = resolveWorkspacePath(input.path);
        await assertFreshRead(path, "Edit");
        if (input.old_string === input.new_string) {
          throw new Error("old_string and new_string must differ");
        }

        const content = await readFile(path, "utf8");
        const count = countOccurrences(content, input.old_string);
        if (count === 0) {
          throw new Error("old_string was not found");
        }
        if (count > 1 && !input.replace_all) {
          throw new Error(`old_string matched ${count} times; set replace_all to replace every match`);
        }

        const next = input.replace_all
          ? content.split(input.old_string).join(input.new_string)
          : content.replace(input.old_string, input.new_string);
        await writeFile(path, next, "utf8");
        state.reads.set(path, await snapshotFile(path, next));
        return textResult(`edited ${path}: replaced ${input.replace_all ? count : 1} occurrence(s)`, {
          path,
          replacements: input.replace_all ? count : 1,
        });
      },
    }),
    defineTool({
      name: "Bash",
      description: "Execute a shell command in the workspace with timeout and output truncation.",
      execute: async (_toolCallId, args, signal) => {
        const input = parseBashArgs(args);
        const commandCwd = input.cwd ? resolveWorkspacePath(input.cwd) : root;
        const timeoutMs = Math.min(input.timeoutMs ?? defaultTimeoutMs, maxTimeoutMs);
        const outputLimit = input.maxOutputBytes ?? maxOutputBytes;

        try {
          const result = await execFileAsync("/bin/bash", ["-lc", input.command], {
            cwd: commandCwd,
            timeout: timeoutMs,
            signal,
            maxBuffer: Math.max(outputLimit * 4, 1024 * 1024),
          });
          return bashResult({ exitCode: 0, stdout: result.stdout, stderr: result.stderr, cwd: commandCwd, outputLimit });
        } catch (cause) {
          if (isTimeoutError(cause)) {
            throw new Error(`Bash command timed out after ${timeoutMs}ms`);
          }
          if (isExecError(cause)) {
            return bashResult({
              exitCode: typeof cause.code === "number" ? cause.code : 1,
              stdout: String(cause.stdout ?? ""),
              stderr: String(cause.stderr ?? cause.message),
              cwd: commandCwd,
              outputLimit,
            });
          }
          throw cause;
        }
      },
    }),
    defineTool({
      name: "Glob",
      description: "Find files by glob pattern under the workspace.",
      execute: async (_toolCallId, args) => {
        const input = parseGlobArgs(args);
        const searchRoot = input.cwd ? resolveWorkspacePath(input.cwd) : root;
        const limit = input.maxResults ?? 100;
        const matcher = globMatcher(input.pattern);
        const files = await listFiles(searchRoot, root);
        const matches = files.filter((file) => matcher(file)).sort();
        const selected = matches.slice(0, limit);
        return textResult(formatLimitedLines(selected, matches.length, limit), {
          matches: selected,
          totalMatches: matches.length,
          truncated: matches.length > limit,
        });
      },
    }),
    defineTool({
      name: "Grep",
      description: "Search file contents with regex and structured match output.",
      execute: async (_toolCallId, args) => {
        const input = parseGrepArgs(args);
        const searchRoot = input.cwd ? resolveWorkspacePath(input.cwd) : root;
        const limit = input.maxResults ?? 100;
        const outputLimit = input.maxOutputBytes ?? maxOutputBytes;
        const regex = new RegExp(input.pattern);
        const fileMatcher = input.glob ? globMatcher(input.glob) : () => true;
        const files = (await listFiles(searchRoot, root)).filter((file) => fileMatcher(file)).sort();
        const matches: GrepMatch[] = [];

        for (const file of files) {
          const path = resolve(root, file);
          const content = await readFile(path, "utf8");
          const lines = content.split(/\r?\n/);
          for (const [index, line] of lines.entries()) {
            if (regex.test(line)) {
              matches.push({ path: file, line: index + 1, text: line });
            }
            regex.lastIndex = 0;
          }
        }

        const selected = matches.slice(0, limit);
        const mode = input.outputMode ?? "files_with_matches";
        const lines = formatGrepLines(selected, mode);
        return textResult(truncate(formatLimitedLines(lines, matches.length, limit), outputLimit, "grep"), {
          matches: selected,
          totalMatches: matches.length,
          truncated: matches.length > limit,
          outputMode: mode,
        });
      },
    }),
    defineTool({
      name: "Todo",
      description: "Maintain a plain session-scoped Todo list.",
      execute: async (_toolCallId, args) => {
        const input = parseTodoArgs(args);
        state.todos = input.todos;
        return textResult(formatTodos(state.todos), { todos: state.todos });
      },
    }),
  ];
};

const parseReadArgs = (args: unknown): ReadArgs => {
  const input = expectRecord(args);
  return {
    path: expectString(input.path, "path"),
    offset: optionalNumber(input.offset, "offset"),
    limit: optionalNumber(input.limit, "limit"),
  };
};

const parseWriteArgs = (args: unknown): WriteArgs => {
  const input = expectRecord(args);
  return {
    path: expectString(input.path, "path"),
    content: expectString(input.content, "content"),
    createParents: optionalBoolean(input.createParents, "createParents"),
  };
};

const parseEditArgs = (args: unknown): EditArgs => {
  const input = expectRecord(args);
  return {
    path: expectString(input.path, "path"),
    old_string: expectString(input.old_string, "old_string"),
    new_string: expectString(input.new_string, "new_string"),
    replace_all: optionalBoolean(input.replace_all, "replace_all"),
  };
};

const parseBashArgs = (args: unknown): BashArgs => {
  const input = expectRecord(args);
  return {
    command: expectString(input.command, "command"),
    cwd: optionalString(input.cwd, "cwd"),
    timeoutMs: optionalNumber(input.timeoutMs, "timeoutMs"),
    maxOutputBytes: optionalNumber(input.maxOutputBytes, "maxOutputBytes"),
  };
};

const parseGlobArgs = (args: unknown): GlobArgs => {
  const input = expectRecord(args);
  return {
    pattern: expectString(input.pattern, "pattern"),
    cwd: optionalString(input.cwd, "cwd"),
    maxResults: optionalNumber(input.maxResults, "maxResults"),
  };
};

const parseGrepArgs = (args: unknown): GrepArgs => {
  const input = expectRecord(args);
  const outputMode = optionalString(input.outputMode, "outputMode");
  if (
    outputMode !== undefined &&
    outputMode !== "files_with_matches" &&
    outputMode !== "content" &&
    outputMode !== "count"
  ) {
    throw new Error("outputMode must be files_with_matches, content, or count");
  }
  return {
    pattern: expectString(input.pattern, "pattern"),
    cwd: optionalString(input.cwd, "cwd"),
    glob: optionalString(input.glob, "glob"),
    outputMode,
    maxResults: optionalNumber(input.maxResults, "maxResults"),
    maxOutputBytes: optionalNumber(input.maxOutputBytes, "maxOutputBytes"),
  };
};

const parseTodoArgs = (args: unknown): TodoArgs => {
  const input = expectRecord(args);
  if (!Array.isArray(input.todos)) {
    throw new Error("todos must be an array");
  }
  const todos = input.todos.map(parseTodoItem);
  const inProgressCount = todos.filter((todo) => todo.status === "in_progress").length;
  if (inProgressCount > 1) {
    throw new Error("Todo allows at most one in_progress item");
  }
  const ids = new Set<string>();
  for (const todo of todos) {
    if (ids.has(todo.id)) {
      throw new Error(`duplicate Todo id: ${todo.id}`);
    }
    ids.add(todo.id);
  }
  return { todos };
};

const parseTodoItem = (value: unknown): TodoItem => {
  const input = expectRecord(value);
  const status = expectString(input.status, "status");
  if (status !== "pending" && status !== "in_progress" && status !== "completed") {
    throw new Error("status must be pending, in_progress, or completed");
  }
  return {
    id: expectString(input.id, "id"),
    content: expectString(input.content, "content"),
    status,
  };
};

const expectRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("tool args must be an object");
  }
  return value as Record<string, unknown>;
};

const expectString = (value: unknown, name: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

const optionalString = (value: unknown, name: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return expectString(value, name);
};

const optionalNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const optionalBoolean = (value: unknown, name: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
};

const snapshotFile = async (path: string, content?: string): Promise<FileReadSnapshot> => {
  const [fileStat, fileContent] = await Promise.all([stat(path), content ?? readFile(path, "utf8")]);
  return {
    hash: createHash("sha256").update(fileContent).digest("hex"),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  };
};

const sameSnapshot = (left: FileReadSnapshot, right: FileReadSnapshot): boolean =>
  left.hash === right.hash && left.size === right.size && left.mtimeMs === right.mtimeMs;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const isWithin = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const countOccurrences = (content: string, needle: string): number => {
  if (needle.length === 0) {
    throw new Error("old_string must not be empty");
  }
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
};

const bashResult = (input: {
  exitCode: number;
  stdout: string;
  stderr: string;
  cwd: string;
  outputLimit: number;
}): ToolResult => {
  const stdout = truncate(input.stdout, input.outputLimit, "stdout");
  const stderr = truncate(input.stderr, input.outputLimit, "stderr");
  return textResult(`exitCode: ${input.exitCode}\ncwd: ${input.cwd}\nstdout:\n${stdout}\nstderr:\n${stderr}`, {
    exitCode: input.exitCode,
    cwd: input.cwd,
  });
};

const truncate = (value: string, maxBytes: number, label: string): string => {
  const bytes = Buffer.byteLength(value);
  if (bytes <= maxBytes) {
    return value;
  }
  const truncated = Buffer.from(value).subarray(0, maxBytes).toString("utf8");
  return `${truncated}\n[${label} truncated: ${bytes} bytes > ${maxBytes} bytes]`;
};

const textResult = (text: string, details?: unknown): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

const byteLength = (value: string): number => Buffer.byteLength(value);

const isTimeoutError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  ("killed" in cause || "signal" in cause) &&
  ((cause as { killed?: unknown }).killed === true || (cause as { signal?: unknown }).signal === "SIGTERM");

const isExecError = (cause: unknown): cause is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  cause instanceof Error && ("stdout" in cause || "stderr" in cause || "code" in cause);

const listFiles = async (directory: string, root: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (!isWithin(root, absolute)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolute, root)));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(root, absolute));
    }
  }
  return files;
};

const globMatcher = (pattern: string): ((path: string) => boolean) => {
  if (pattern.length === 0) {
    throw new Error("pattern must not be empty");
  }
  const regex = new RegExp(`^${globToRegex(pattern)}$`);
  return (path) => regex.test(path);
};

const globToRegex = (pattern: string): string => {
  let output = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      output += "[^/]*";
      continue;
    }
    if (char === "?") {
      output += "[^/]";
      continue;
    }
    output += escapeRegex(char ?? "");
  }
  return output;
};

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

const formatLimitedLines = (lines: string[], total: number, limit: number): string => {
  const body = lines.join("\n");
  if (total <= limit) {
    return body;
  }
  const suffix = `[truncated: ${total} matches > ${limit} limit]`;
  return body.length > 0 ? `${body}\n${suffix}` : suffix;
};

const formatGrepLines = (matches: GrepMatch[], mode: NonNullable<GrepArgs["outputMode"]>): string[] => {
  if (mode === "content") {
    return matches.map((match) => `${match.path}:${match.line}:${match.text}`);
  }
  if (mode === "count") {
    const counts = new Map<string, number>();
    for (const match of matches) {
      counts.set(match.path, (counts.get(match.path) ?? 0) + 1);
    }
    return [...counts.entries()].map(([path, count]) => `${path}:${count}`);
  }
  return [...new Set(matches.map((match) => match.path))];
};

const formatTodos = (todos: TodoItem[]): string =>
  todos.map((todo) => `[${todo.status}] ${todo.id} ${todo.content}`).join("\n");
