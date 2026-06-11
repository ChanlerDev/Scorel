import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitHubReleaseRequest,
  buildGitHubReleaseUploadRequest,
  createGitHubRelease,
  parseGitHubRepository,
  uploadGitHubReleaseAsset,
} from "./release.mjs";

test("parseGitHubRepository accepts GitHub Actions repository env", () => {
  assert.deepEqual(parseGitHubRepository({ GITHUB_REPOSITORY: "ChanlerDev/Scorel" }), {
    owner: "ChanlerDev",
    repo: "Scorel",
  });
});

test("parseGitHubRepository accepts package repository ssh url", () => {
  assert.deepEqual(
    parseGitHubRepository({
      packageRepositoryUrl: "git+ssh://git@github.com/ChanlerDev/Scorel.git",
    }),
    {
      owner: "ChanlerDev",
      repo: "Scorel",
    },
  );
});

test("buildGitHubReleaseRequest creates a release for an existing tag", () => {
  const request = buildGitHubReleaseRequest({
    owner: "ChanlerDev",
    repo: "Scorel",
    tagName: "v0.0.2",
    releaseName: "v0.0.2",
    body: "## 0.0.2 - 2026-06-12\n\n- Release notes",
    token: "github-token",
  });

  assert.equal(request.url, "https://api.github.com/repos/ChanlerDev/Scorel/releases");
  assert.equal(request.body.tag_name, "v0.0.2");
  assert.equal(request.body.name, "v0.0.2");
  assert.equal(request.body.body, "## 0.0.2 - 2026-06-12\n\n- Release notes");
  assert.equal(request.body.draft, false);
  assert.equal(request.body.prerelease, false);
  assert.equal(request.headers.authorization, "Bearer github-token");
});

test("createGitHubRelease requires a token", async () => {
  await assert.rejects(
    createGitHubRelease({
      owner: "ChanlerDev",
      repo: "Scorel",
      tagName: "v0.0.2",
      releaseName: "v0.0.2",
      body: "notes",
      token: "",
    }),
    /GITHUB_TOKEN or GH_TOKEN is required/,
  );
});

test("buildGitHubReleaseUploadRequest uploads the npm pack tarball", () => {
  const request = buildGitHubReleaseUploadRequest({
    uploadUrl: "https://uploads.github.com/repos/ChanlerDev/Scorel/releases/1/assets{?name,label}",
    assetName: "chanlerdev-scorel-0.0.2.tgz",
    token: "github-token",
  });

  assert.equal(request.url, "https://uploads.github.com/repos/ChanlerDev/Scorel/releases/1/assets?name=chanlerdev-scorel-0.0.2.tgz");
  assert.equal(request.headers.authorization, "Bearer github-token");
  assert.equal(request.headers["content-type"], "application/gzip");
});

test("uploadGitHubReleaseAsset posts tarball bytes", async () => {
  const calls = [];
  const asset = await uploadGitHubReleaseAsset({
    uploadUrl: "https://uploads.github.com/repos/ChanlerDev/Scorel/releases/1/assets{?name,label}",
    assetName: "scorel-0.0.2.tgz",
    assetContent: Buffer.from("tgz-content"),
    token: "github-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ browser_download_url: "https://github.com/ChanlerDev/Scorel/releases/download/v0.0.2/scorel-0.0.2.tgz" }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://uploads.github.com/repos/ChanlerDev/Scorel/releases/1/assets?name=scorel-0.0.2.tgz");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body, Buffer.from("tgz-content"));
  assert.equal(asset.browser_download_url, "https://github.com/ChanlerDev/Scorel/releases/download/v0.0.2/scorel-0.0.2.tgz");
});
