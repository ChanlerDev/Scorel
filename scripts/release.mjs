#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { generateReleaseNotes, insertReleaseNotes } from "./release-notes.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const packagePaths = [
  "package.json",
  "apps/cli/package.json",
  "apps/relay/package.json",
  "apps/webui/package.json",
  "packages/client/package.json",
  "packages/core/package.json",
  "packages/daemon/package.json",
  "packages/protocol/package.json",
];

const usage = () => {
  console.error("Usage: pnpm release <patch|minor|major> [--dry-run] [--no-publish] [--no-push] [--allow-dirty] [--no-generate-notes]");
};

const args = process.argv.slice(2);
const bump = args.find((arg) => !arg.startsWith("-"));
const dryRun = args.includes("--dry-run");
const noPublish = args.includes("--no-publish");
const noPush = args.includes("--no-push");
const noGenerateNotes = args.includes("--no-generate-notes");
const allowDirty = args.includes("--allow-dirty") || process.env.SCOREL_RELEASE_ALLOW_DIRTY === "1";

if (!bump || !["patch", "minor", "major"].includes(bump)) {
  usage();
  process.exit(1);
}

const run = (cmd, args, options = {}) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

const capture = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
};

const assertReleaseState = () => {
  const branch = capture("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Release requires a non-detached HEAD");
  }
  const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty && !allowDirty) {
    throw new Error("Release requires a clean tracked working tree. Commit or stash changes first.");
  }
  if (dirty && allowDirty) {
    console.warn("warning: allowing dirty tracked working tree for this run");
  }
};

const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

const writeJson = async (path, value) => {
  await writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
};

const bumpVersion = (version, kind) => {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  const [major, minor, patch] = parts;
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const updateVersions = async (nextVersion) => {
  for (const path of packagePaths) {
    const pkg = await readJson(path);
    pkg.version = nextVersion;
    await writeJson(path, pkg);
  }
};

const updateChangelog = async (nextVersion) => {
  const path = resolve(root, "docs/CHANGELOG.md");
  const current = await readFile(path, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const marker = "## Unreleased\n";
  if (!current.includes(marker)) {
    throw new Error("docs/CHANGELOG.md is missing ## Unreleased");
  }
  const updated = current.replace(marker, `${marker}\n## ${nextVersion} - ${today}\n`);
  await writeFile(path, updated);
};

const updateChangelogWithNotes = async (markdown) => {
  const path = resolve(root, "docs/CHANGELOG.md");
  const current = await readFile(path, "utf8");
  await writeFile(path, insertReleaseNotes(current, markdown));
};

const publish = () => {
  run("npm", ["publish"]);
};

assertReleaseState();

const rootPkg = await readJson("package.json");
const nextVersion = bumpVersion(rootPkg.version, bump);
console.log(`release ${bump}: ${rootPkg.version} -> ${nextVersion}${dryRun ? " (dry-run)" : ""}`);

const previousTag = (() => {
  try {
    return capture("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  } catch {
    return "";
  }
})();

let generatedNotes;
if (!noGenerateNotes) {
  console.log(`generating release notes for ${previousTag ? `${previousTag}..HEAD` : "HEAD"} using DeepSeek`);
  generatedNotes = await generateReleaseNotes({
    from: previousTag,
    to: "HEAD",
    version: nextVersion,
    allowFallback: dryRun,
  });
  if (generatedNotes.fallback) {
    console.warn(`warning: using fallback release notes preview: ${generatedNotes.error instanceof Error ? generatedNotes.error.message : String(generatedNotes.error)}`);
  }
  if (dryRun) {
    console.log("\nrelease notes preview:\n");
    console.log(generatedNotes.markdown.trim());
  }
}

run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);
run("node", ["--test", "scripts/release-notes.test.mjs"]);
run("pnpm", ["--filter", "@scorel/app-webui", "build"]);
run("pnpm", ["build:package"]);
run("pnpm", ["pack:smoke"]);

if (dryRun) {
  console.log(`dry-run passed; next release would be v${nextVersion}`);
  process.exit(0);
}

await updateVersions(nextVersion);
if (generatedNotes) {
  await updateChangelogWithNotes(generatedNotes.markdown);
} else {
  await updateChangelog(nextVersion);
}
run("pnpm", ["install", "--lockfile-only"]);
run("pnpm", ["build:package"]);
run("pnpm", ["pack:smoke"]);
run("git", ["add", ...packagePaths, "pnpm-lock.yaml", "docs/CHANGELOG.md"]);
run("git", ["add", "-f", "dist/index.js", "dist/index.js.map"]);
run("git", ["commit", "-m", `release: v${nextVersion}`]);
run("git", ["tag", `v${nextVersion}`]);

if (noPublish) {
  console.log(`release commit and tag created for v${nextVersion}; npm publish skipped`);
} else {
  publish();
  console.log(`published ${rootPkg.name}@${nextVersion}`);
}

if (noPush) {
  console.log(`git push skipped for v${nextVersion}`);
  process.exit(0);
}

const branch = capture("git", ["branch", "--show-current"]);
run("git", ["push", "origin", branch]);
run("git", ["push", "origin", `v${nextVersion}`]);
console.log(`pushed ${branch} and v${nextVersion}`);
