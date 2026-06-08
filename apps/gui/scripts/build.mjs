import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outdir = join(root, ".dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await Promise.all([
  build({
    entryPoints: [join(root, "src/main.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: join(outdir, "main.cjs"),
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [join(root, "src/preload.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: join(outdir, "preload.cjs"),
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [join(root, "src/renderer/main.tsx")],
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "iife",
    outfile: join(outdir, "renderer.js"),
    sourcemap: true,
    loader: { ".css": "css" },
    jsx: "automatic",
  }),
  cp(join(root, "src/index.html"), join(outdir, "index.html")),
]);
