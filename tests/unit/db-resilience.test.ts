import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import {
  createSession,
  getSessionDetail,
  initDatabase,
} from "../../src/main/storage/db.js";

describe("db resilience", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("returns null permission config when session JSON is corrupted", () => {
    createSession(db, {
      id: "session-1",
      workspaceRoot: "/tmp/workspace",
    });
    db.prepare("UPDATE sessions SET permission_config = ? WHERE id = ?").run("{invalid-json", "session-1");

    const detail = getSessionDetail(db, "session-1");

    expect(detail).not.toBeNull();
    expect(detail?.permissionConfig).toBeNull();
  });
});
