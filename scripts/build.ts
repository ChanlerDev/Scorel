const { execSync } = require("node:child_process");

function run(command: string): void {
  execSync(command, { stdio: "inherit" });
}

console.log("==> Building application bundles");
run("pnpm build");

console.log("==> Packaging with electron-builder");
try {
  run("pnpm exec electron-builder --config electron-builder.yml");
} finally {
  console.log("==> Restoring better-sqlite3 for local Node-based tests");
  run("pnpm rebuild better-sqlite3");
}

console.log("==> Done. Artifacts are in release/");
