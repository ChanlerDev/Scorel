import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(root, "..", "..");
const defaultOutDir = join(root, ".runtime");
const defaultCliEntryPoint = join(workspaceRoot, "apps", "cli", "src", "bin.ts");

export const buildGuiRuntime = async ({
  cliEntryPath,
  cliEntryPoint = defaultCliEntryPoint,
  outDir = defaultOutDir,
  appExecutableRelativePath = "../MacOS/Scorel",
} = {}) => {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const cliTarget = join(outDir, "scorel.js");
  if (cliEntryPath) {
    await cp(cliEntryPath, cliTarget);
  } else {
    await build({
      entryPoints: [cliEntryPoint],
      outfile: cliTarget,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      banner: {
        js: 'import { createRequire as __scorelCreateRequire } from "node:module";\nconst require = __scorelCreateRequire(import.meta.url);',
      },
      sourcemap: false,
      logLevel: "silent",
    });
    const built = await readFile(cliTarget, "utf8");
    await writeFile(cliTarget, built.replace(/^#!.*\n/, ""));
  }
  await chmod(cliTarget, 0o755);

  const launcherPath = join(outDir, "scorel");
  await writeFile(launcherPath, launcherScript(appExecutableRelativePath));
  await chmod(launcherPath, 0o755);
};

const launcherScript = (appExecutableRelativePath) => `#!/bin/sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_EXECUTABLE="$DIR/${appExecutableRelativePath}"
export ELECTRON_RUN_AS_NODE=1
exec "$APP_EXECUTABLE" "$DIR/scorel.js" "$@"
`;

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  buildGuiRuntime().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
