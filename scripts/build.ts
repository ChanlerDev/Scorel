import { execSync } from "node:child_process";

function run(command: string): void {
  execSync(command, { stdio: "inherit" });
}

console.log("==> Building application bundles");
run("pnpm build");

console.log("==> Packaging with electron-builder");
let buildError: unknown = null;
try {
  run("pnpm exec electron-builder --config electron-builder.yml");
} catch (error: unknown) {
  buildError = error;
}

console.log("==> Restoring better-sqlite3 for local Node-based tests");
try {
  run("pnpm rebuild better-sqlite3");
} catch (rebuildError: unknown) {
  if (buildError) {
    console.error("==> better-sqlite3 rebuild also failed after electron-builder failed");
    console.error(rebuildError);
    throw buildError;
  }
  throw rebuildError;
}

if (buildError) {
  throw buildError;
}

console.log("==> Done. Artifacts are in release/");
