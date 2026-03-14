import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceManager, sanitizeWorkspaceKey } from "../src/workspace.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workspace manager", () => {
  it("sanitizes workspace keys", () => {
    expect(sanitizeWorkspaceKey("ABC-1/hello world")).toBe("ABC-1_hello_world");
  });

  it("runs after_create only on first creation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scorel-workspace-"));
    tempDirs.push(dir);
    const marker = path.join(dir, "marker.txt");
    const manager = new WorkspaceManager(
      { root: dir },
      {
        afterCreate: `echo first-run >> ${JSON.stringify(marker)}`,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 5_000
      }
    );

    const first = await manager.ensureWorkspace("ABC-1");
    const second = await manager.ensureWorkspace("ABC-1");

    expect(first.createdNow).toBe(true);
    expect(second.createdNow).toBe(false);
    expect(await readFile(marker, "utf8")).toBe("first-run\n");
  });
});
