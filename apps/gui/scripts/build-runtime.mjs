import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(root, "..", "..");
const defaultOutDir = join(root, ".runtime");
const defaultCliEntryPath = join(workspaceRoot, "dist", "index.js");

export const buildGuiRuntime = async ({
  cliEntryPath = defaultCliEntryPath,
  outDir = defaultOutDir,
  appExecutableRelativePath = "../MacOS/Scorel",
} = {}) => {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const cliTarget = join(outDir, "scorel.js");
  await cp(cliEntryPath, cliTarget);
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
