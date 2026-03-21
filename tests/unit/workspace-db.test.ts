import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import {
  initDatabase,
  listWorkspaces,
  upsertWorkspace,
} from "../../src/main/storage/db.js";

describe("workspace storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("stores unique workspaces and refreshes recency on reuse", async () => {
    upsertWorkspace(db, "/tmp/a");
    await new Promise((resolve) => setTimeout(resolve, 2));
    upsertWorkspace(db, "/tmp/b");
    await new Promise((resolve) => setTimeout(resolve, 2));
    upsertWorkspace(db, "/tmp/a");

    const workspaces = listWorkspaces(db, 20);

    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]?.path).toBe("/tmp/a");
    expect(workspaces[1]?.path).toBe("/tmp/b");
    expect(workspaces[0]!.lastUsedAt).toBeGreaterThanOrEqual(workspaces[1]!.lastUsedAt);
  });

  it("returns recent workspaces in descending last-used order with limit applied", async () => {
    for (const workspacePath of ["/tmp/one", "/tmp/two", "/tmp/three"]) {
      upsertWorkspace(db, workspacePath);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const workspaces = listWorkspaces(db, 2);

    expect(workspaces.map((workspace) => workspace.path)).toEqual([
      "/tmp/three",
      "/tmp/two",
    ]);
  });

  it("evicts the oldest entries when the history grows beyond twenty workspaces", async () => {
    for (let index = 0; index < 25; index += 1) {
      upsertWorkspace(db, `/tmp/ws-${String(index).padStart(2, "0")}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const workspaces = listWorkspaces(db, 100);

    expect(workspaces).toHaveLength(20);
    expect(workspaces.some((workspace) => workspace.path === "/tmp/ws-00")).toBe(false);
    expect(workspaces.some((workspace) => workspace.path === "/tmp/ws-04")).toBe(false);
    expect(workspaces.some((workspace) => workspace.path === "/tmp/ws-05")).toBe(true);
    expect(workspaces.some((workspace) => workspace.path === "/tmp/ws-24")).toBe(true);
  });
});
