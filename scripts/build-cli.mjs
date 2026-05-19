import { chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(repoRoot, "apps/cli");

await build({
  entryPoints: [join(cliRoot, "src/index.ts")],
  outfile: join(cliRoot, "dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true
});

await chmod(join(cliRoot, "dist/index.js"), 0o755);
