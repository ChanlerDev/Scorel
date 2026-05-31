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
  // Self-hosted woff2 design-system fonts (S0040). The two packages drop
  // pure CSS @font-face declarations into the bundle; no JavaScript or
  // network calls. Allowing them as externals keeps the boundary test
  // honest while still blocking arbitrary npm packages.
  "@fontsource/newsreader",
  "@fontsource/jetbrains-mono",
  // S0041 markdown stack: react-markdown + GFM + sanitizer + Shiki. Each
  // entry is justified one line apart so future audits can trace why.
  "react-markdown", // markdown→React-tree renderer (no innerHTML)
  "remark-gfm", // GFM tables, task lists, strikethrough, autolink
  "rehype-sanitize", // hast schema-based XSS guard (rehype-raw NEVER enabled)
  "shiki", // VS Code-grade syntax highlighting (lazy chunked)
  "@shikijs/rehype", // rehype adapter for Shiki (kept for future direct use)
]);

const ALLOWED_PREFIXES = [
  "next/",
  "@fontsource/newsreader/",
  "@fontsource/jetbrains-mono/",
  // Shiki's themes / langs / engine submodules are imported lazily via
  // `import("shiki/...")` in `shiki-code-block.tsx`. The prefix lets the
  // boundary test see the dynamic chunks without enumerating every grammar.
  "shiki/",
];

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
// Side-effect imports: `import "..."`. Used by @fontsource css imports.
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+["']([^"']+)["']/gm;

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

function isServerRouteFile(rel: string): boolean {
  // Next App Router server-only files. They never enter the client bundle, so
  // node:* imports are safe; the route handler at app/api/local-daemon/route.ts
  // (S0043) needs node:fs/promises + node:os + node:path to read
  // ~/.scorel/daemon.json.
  const norm = rel.split(path.sep).join("/");
  return /(^|\/)route\.(ts|tsx)$/.test(norm);
}

describe("apps/webui package boundaries", () => {
  it("only imports from approved externals (react, next, @scorel/protocol|client, @fontsource/*)", async () => {
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
      // Server-only route handlers are not bundled into the client; allow
      // node:* and other server externals there.
      if (isServerRouteFile(rel)) continue;

      const text = await fs.readFile(file, "utf8");
      const specs = new Set<string>();
      IMPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IMPORT_RE.exec(text)) !== null) {
        specs.add(match[1] as string);
      }
      SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
      while ((match = SIDE_EFFECT_IMPORT_RE.exec(text)) !== null) {
        specs.add(match[1] as string);
      }
      for (const spec of specs) {
        if (!isAllowed(spec) || isForbidden(spec)) {
          violations.push(`${rel}: ${spec}`);
        }
      }
    }

    expect(violations, `Forbidden imports:\n${violations.join("\n")}`).toEqual([]);
  });

  it("explicitly whitelists @fontsource/newsreader and @fontsource/jetbrains-mono", () => {
    expect(ALLOWED_EXTERNALS.has("@fontsource/newsreader")).toBe(true);
    expect(ALLOWED_EXTERNALS.has("@fontsource/jetbrains-mono")).toBe(true);
    expect(ALLOWED_PREFIXES).toContain("@fontsource/newsreader/");
    expect(ALLOWED_PREFIXES).toContain("@fontsource/jetbrains-mono/");
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

  it("forbids literal palette utilities outside design tokens", async () => {
    // Match Tailwind palette utilities that bypass the design tokens. We use
    // word boundaries on both sides so compound class names like
    // `prose-zinc` (typography plugin variant) or `text-zinc-foo` are not
    // matched — only standalone `zinc-100`, `emerald-500`, etc.
    //
    // Allowed palette names map roughly to the colors we removed in S0040.
    // Any new use should go through `bg-surface`, `text-muted`,
    // `border-subtle`, `text-accent`, `text-status-*`, etc.
    const PALETTE_RE = /\b(zinc|emerald|red|amber|sky|stone|slate|gray)-\d{2,3}\b/g;

    const files: string[] = [];
    for (const sub of ["app", "components"]) {
      files.push(...(await walk(path.join(appRoot, sub))));
    }

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(appRoot, file);
      if (isTestFile(rel)) continue;
      const text = await fs.readFile(file, "utf8");
      PALETTE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PALETTE_RE.exec(text)) !== null) {
        offenders.push(`${rel}: ${match[0]}`);
      }
    }
    expect(
      offenders,
      `Literal palette utilities are banned outside design tokens. Use semantic classes (\`bg-surface\`, \`text-muted\`, \`text-status-*\`).\nOffenders:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
