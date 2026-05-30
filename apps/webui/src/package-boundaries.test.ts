import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");

const SCAN_DIRS = ["app", "components", "lib", "src"];

const ALLOWED_EXTERNALS = new Set([
  "react",
  "react-dom",
  "next",
  "@scorel/protocol",
  "@scorel/client",
]);

const ALLOWED_PREFIXES = ["next/"];

const FORBIDDEN_EXTERNALS = new Set([
  "@scorel/core",
  "@scorel/daemon",
  "fs",
  "path",
  "os",
  "child_process",
  "net",
  "http",
  "https",
  "stream",
  "tls",
  "ws",
]);

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

function specifierIsRelative(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

function isAllowed(spec: string): boolean {
  if (specifierIsRelative(spec)) return true;
  if (ALLOWED_EXTERNALS.has(spec)) return true;
  for (const prefix of ALLOWED_PREFIXES) {
    if (spec.startsWith(prefix)) return true;
  }
  return false;
}

function isForbidden(spec: string): boolean {
  if (FORBIDDEN_EXTERNALS.has(spec)) return true;
  if (spec.startsWith("@scorel/core/")) return true;
  if (spec.startsWith("@scorel/daemon/")) return true;
  // Disallow node:* builtins in browser code paths.
  if (spec.startsWith("node:")) return true;
  return false;
}

function isTestFile(rel: string): boolean {
  return rel.endsWith(".test.ts") || rel.endsWith(".test.tsx");
}

describe("apps/webui package boundaries", () => {
  it("only imports from approved externals (react, next, @scorel/protocol|client)", async () => {
    const files: string[] = [];
    for (const sub of SCAN_DIRS) {
      files.push(...(await walk(path.join(appRoot, sub))));
    }

    const violations: string[] = [];

    for (const file of files) {
      const rel = path.relative(appRoot, file);
      // Skip the test files themselves — they intentionally reference forbidden
      // module names as data, and routes.test.ts walks the app/ tree.
      if (isTestFile(rel)) continue;

      const text = await fs.readFile(file, "utf8");
      IMPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IMPORT_RE.exec(text)) !== null) {
        const spec = match[1] as string;
        if (!isAllowed(spec) || isForbidden(spec)) {
          violations.push(`${rel}: ${spec}`);
        }
      }
    }

    expect(violations, `Forbidden imports:\n${violations.join("\n")}`).toEqual([]);
  });

  it("localStorage references stay inside lib/store/", async () => {
    const files: string[] = [];
    for (const sub of SCAN_DIRS) {
      files.push(...(await walk(path.join(appRoot, sub))));
    }

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(appRoot, file);
      if (isTestFile(rel)) continue;
      const norm = rel.split(path.sep).join("/");
      if (norm.startsWith("lib/store/")) continue;
      const text = await fs.readFile(file, "utf8");
      if (text.includes("localStorage")) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `localStorage must only be referenced under lib/store/.\nOffenders:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
