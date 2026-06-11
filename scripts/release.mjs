#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
  console.error("Usage: pnpm release <patch|minor|major> [--dry-run] [--no-publish] [--no-push] [--allow-dirty] [--no-generate-notes] [--no-github-release]");
};

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

const capture = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { cwd: options.cwd ?? root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
};

const assertReleaseState = (options = {}) => {
  const branch = capture("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Release requires a non-detached HEAD");
  }
  const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty && !options.allowDirty) {
    throw new Error("Release requires a clean tracked working tree. Commit or stash changes first.");
  }
  if (dirty && options.allowDirty) {
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

const packReleaseTarball = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "scorel-release-pack-"));
  try {
    const packOutput = capture("npm", ["pack", "--json", "--pack-destination", tempRoot]);
    const [packed] = JSON.parse(packOutput);
    if (!packed?.filename || typeof packed.filename !== "string") {
      throw new Error(`npm pack did not return a filename: ${packOutput}`);
    }
    return {
      path: join(tempRoot, packed.filename),
      name: packed.filename,
      cleanup: () => rm(tempRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
};

export const parseGitHubRepository = (options = {}) => {
  const repository = options.GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
  if (repository && /^[^/\s]+\/[^/\s]+$/.test(repository)) {
    const [owner, repo] = repository.split("/");
    return { owner, repo };
  }

  const repositoryUrl = options.packageRepositoryUrl;
  if (repositoryUrl) {
    const match = /github\.com[:/]([^/\s]+)\/([^/\s.]+)(?:\.git)?$/.exec(repositoryUrl);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  throw new Error("Unable to determine GitHub repository. Set GITHUB_REPOSITORY or package repository.url.");
};

export const buildGitHubReleaseRequest = ({ owner, repo, tagName, releaseName, body, token }) => {
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required to create a GitHub Release");
  }
  return {
    url: `https://api.github.com/repos/${owner}/${repo}/releases`,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: {
      tag_name: tagName,
      name: releaseName,
      body,
      draft: false,
      prerelease: false,
    },
  };
};

export const createGitHubRelease = async ({ owner, repo, tagName, releaseName, body, token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, fetchImpl = globalThis.fetch }) => {
  const request = buildGitHubReleaseRequest({ owner, repo, tagName, releaseName, body, token });
  if (!fetchImpl) {
    throw new Error("fetch is unavailable in this Node runtime");
  }
  const response = await fetchImpl(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const text = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`GitHub Release creation failed status=${response.status}${text ? `\n${text}` : ""}`);
  }
  return response.json();
};

export const buildGitHubReleaseUploadRequest = ({ uploadUrl, assetName, token }) => {
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required to upload a GitHub Release asset");
  }
  const baseUrl = uploadUrl.replace(/\{.*\}$/, "");
  return {
    url: `${baseUrl}?name=${encodeURIComponent(assetName)}`,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/gzip",
      "x-github-api-version": "2022-11-28",
    },
  };
};

export const uploadGitHubReleaseAsset = async ({
  uploadUrl,
  assetPath,
  assetName = assetPath ? basename(assetPath) : undefined,
  assetContent,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  fetchImpl = globalThis.fetch,
}) => {
  if (!assetName) {
    throw new Error("assetName is required to upload a GitHub Release asset");
  }
  const request = buildGitHubReleaseUploadRequest({ uploadUrl, assetName, token });
  if (!fetchImpl) {
    throw new Error("fetch is unavailable in this Node runtime");
  }
  const content = assetContent ?? await readFile(assetPath);
  const response = await fetchImpl(request.url, {
    method: "POST",
    headers: request.headers,
    body: content,
  });
  if (!response.ok) {
    const text = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`GitHub Release asset upload failed status=${response.status}${text ? `\n${text}` : ""}`);
  }
  return response.json();
};

const minimalReleaseNotes = (version) => `## ${version} - ${new Date().toISOString().slice(0, 10)}\n\nNo detailed release notes were generated.\n`;

export const runReleaseCli = async (argv = process.argv.slice(2)) => {
  const bump = argv.find((arg) => !arg.startsWith("-"));
  const dryRun = argv.includes("--dry-run");
  const noPublish = argv.includes("--no-publish");
  const noPush = argv.includes("--no-push");
  const noGenerateNotes = argv.includes("--no-generate-notes");
  const noGitHubRelease = argv.includes("--no-github-release");
  const allowDirty = argv.includes("--allow-dirty") || process.env.SCOREL_RELEASE_ALLOW_DIRTY === "1";

  if (!bump || !["patch", "minor", "major"].includes(bump)) {
    usage();
    process.exit(1);
  }

  assertReleaseState({ allowDirty });

  const rootPkg = await readJson("package.json");
  const nextVersion = bumpVersion(rootPkg.version, bump);
  const shouldCreateGitHubRelease = !dryRun && !noPush && !noGitHubRelease;
  const githubRepository = shouldCreateGitHubRelease ? parseGitHubRepository({ packageRepositoryUrl: rootPkg.repository?.url }) : undefined;
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (shouldCreateGitHubRelease && !githubToken) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required to create a GitHub Release. Use --no-github-release to skip.");
  }
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
  run("node", ["--test", "scripts/release.test.mjs"]);
  run("pnpm", ["--filter", "@scorel/app-webui", "build"]);
  run("pnpm", ["build:package"]);
  run("pnpm", ["pack:smoke"]);

  if (dryRun) {
    console.log(`dry-run passed; next release would be v${nextVersion}`);
    process.exit(0);
  }

  await updateVersions(nextVersion);
  const releaseBody = generatedNotes ? generatedNotes.markdown : minimalReleaseNotes(nextVersion);
  if (generatedNotes) {
    await updateChangelogWithNotes(generatedNotes.markdown);
  } else {
    await updateChangelog(nextVersion);
  }
  run("pnpm", ["install", "--lockfile-only"]);
  run("pnpm", ["build:package"]);
  run("pnpm", ["pack:smoke"]);
  const releaseTarball = await packReleaseTarball();
  run("git", ["add", ...packagePaths, "pnpm-lock.yaml", "docs/CHANGELOG.md"]);
  run("git", ["add", "-f", "dist/index.js", "dist/index.js.map"]);
  run("git", ["commit", "-m", `release: v${nextVersion}`]);
  run("git", ["tag", `v${nextVersion}`]);

  try {
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

    if (noGitHubRelease) {
      console.log(`GitHub Release skipped for v${nextVersion}`);
    } else {
      const release = await createGitHubRelease({
        ...githubRepository,
        tagName: `v${nextVersion}`,
        releaseName: `v${nextVersion}`,
        body: releaseBody,
        token: githubToken,
      });
      console.log(`created GitHub Release ${release.html_url ?? `v${nextVersion}`}`);
      const asset = await uploadGitHubReleaseAsset({
        uploadUrl: release.upload_url,
        assetPath: releaseTarball.path,
        assetName: releaseTarball.name,
        token: githubToken,
      });
      console.log(`uploaded GitHub Release asset ${asset.browser_download_url ?? releaseTarball.name}`);
    }

    console.log(`pushed ${branch} and v${nextVersion}`);
  } finally {
    await releaseTarball.cleanup();
  }
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runReleaseCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
