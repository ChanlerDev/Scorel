#!/usr/bin/env node
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(new URL("..", import.meta.url).pathname);
const outfile = resolve(root, "dist/index.js");

await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "apps/cli/src/bin.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@mariozechner/pi-ai", "ws"],
  sourcemap: true,
  logLevel: "info",
});

const built = await readFile(outfile, "utf8");
const withoutSourceShebang = built.replace(/^#!.*\n/, "");
await writeFile(outfile, `#!/usr/bin/env node\n${withoutSourceShebang}`);
await chmod(outfile, 0o755);
console.log(`built ${outfile}`);
