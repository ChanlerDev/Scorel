import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

import { buildGuiRuntime } from "./build-runtime.mjs";

test("buildGuiRuntime creates a relocatable bundled scorel launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-gui-runtime-test-"));
  try {
    const cliEntryPath = join(root, "dist-index.js");
    await writeFile(cliEntryPath, "console.log('scorel js')\n");
    const outDir = join(root, "runtime");
    const macosDir = join(root, "MacOS");
    await mkdir(macosDir, { recursive: true });
    const fakeElectron = join(macosDir, "Scorel");
    await writeFile(fakeElectron, "#!/bin/sh\nprintf 'electron=%s env=%s js=%s args=%s\\n' \"$0\" \"$ELECTRON_RUN_AS_NODE\" \"$1\" \"$2\"\n");
    await chmod(fakeElectron, 0o755);

    await buildGuiRuntime({
      cliEntryPath,
      outDir,
      appExecutableRelativePath: "../MacOS/Scorel",
    });

    await expectExecutable(join(outDir, "scorel"));
    assert.equal(await readFile(join(outDir, "scorel.js"), "utf8"), "console.log('scorel js')\n");

    const result = spawnSync(join(outDir, "scorel"), ["host"], {
      cwd: root,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /electron=.*\/MacOS\/Scorel env=1 js=.*\/runtime\/scorel\.js args=host/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function expectExecutable(path) {
  const mode = (await stat(path)).mode;
  assert.equal((mode & 0o111) !== 0, true, `${path} is not executable`);
}
