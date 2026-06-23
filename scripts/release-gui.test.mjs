import assert from "node:assert/strict";
import test from "node:test";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectGuiReleaseAssets, guiReleaseAssetPaths, packagePaths } from "./release.mjs";

test("release version lockstep includes the GUI app package", () => {
  assert.ok(packagePaths.includes("apps/gui/package.json"));
});

test("release asset contract includes npm tarball plus GUI incremental metadata", () => {
  assert.deepEqual(guiReleaseAssetPaths(), [
    "apps/gui/release/latest-mac.yml",
    "apps/gui/release/*.dmg",
    "apps/gui/release/*.dmg.blockmap",
    "apps/gui/release/*.zip",
    "apps/gui/release/*.zip.blockmap",
  ]);
});

test("GUI package vendors the built CLI as a bundled scorel runtime", async () => {
  const guiPackage = JSON.parse(await readFile(join(process.cwd(), "apps/gui/package.json"), "utf8"));

  assert.deepEqual(guiPackage.build.extraResources, [
    {
      from: ".runtime",
      to: ".",
    },
  ]);
  assert.match(guiPackage.scripts["dist:mac"], /\bbuild:package\b/);
  assert.match(guiPackage.scripts["dist:mac"], /\bbuild:runtime\b/);
});

test("collectGuiReleaseAssets keeps only mac installer and blockmap metadata", async () => {
  const releaseDir = join(process.cwd(), "apps/gui/release");
  await rm(releaseDir, { recursive: true, force: true });
  try {
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, "latest-mac.yml"), "version: 0.0.5\n");
    await writeFile(join(releaseDir, "Scorel-0.0.5.dmg"), "");
    await writeFile(join(releaseDir, "Scorel-0.0.5.dmg.blockmap"), "");
    await writeFile(join(releaseDir, "builder-debug.yml"), "");

    assert.deepEqual((await collectGuiReleaseAssets()).map((asset) => asset.name), [
      "Scorel-0.0.5.dmg",
      "Scorel-0.0.5.dmg.blockmap",
      "latest-mac.yml",
    ]);
  } finally {
    await rm(releaseDir, { recursive: true, force: true });
  }
});
