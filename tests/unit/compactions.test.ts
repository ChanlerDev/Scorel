import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase, createSession, deleteSession } from "../../src/main/storage/db.js";
import {
  getCompaction,
  insertCompaction,
  listCompactions,
  updateSessionCompact,
} from "../../src/main/storage/compactions.js";

describe("compactions storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    createSession(db, { id: "session-1", workspaceRoot: "/tmp/workspace" });
  });

  it("inserts and fetches a compaction record", () => {
    insertCompaction(db, {
      id: "cmp-1",
      sessionId: "session-1",
      boundaryMessageId: "msg-3",
      summaryText: "Summary text",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: "/tmp/compact.jsonl",
      createdAt: 100,
    });

    expect(getCompaction(db, "cmp-1")).toEqual({
      id: "cmp-1",
      sessionId: "session-1",
      boundaryMessageId: "msg-3",
      summaryText: "Summary text",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: "/tmp/compact.jsonl",
      createdAt: 100,
    });
  });

  it("lists compactions in descending createdAt order", () => {
    insertCompaction(db, {
      id: "cmp-1",
      sessionId: "session-1",
      boundaryMessageId: "msg-1",
      summaryText: "Older",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: null,
      createdAt: 100,
    });
    insertCompaction(db, {
      id: "cmp-2",
      sessionId: "session-1",
      boundaryMessageId: "msg-2",
      summaryText: "Newer",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: null,
      createdAt: 200,
    });

    expect(listCompactions(db, "session-1").map((record) => record.id)).toEqual([
      "cmp-2",
      "cmp-1",
    ]);
  });

  it("updates the active compaction on the session", () => {
    updateSessionCompact(db, "session-1", "cmp-9");

    const row = db
      .prepare("SELECT active_compact_id AS activeCompactId FROM sessions WHERE id = ?")
      .get("session-1") as { activeCompactId: string | null } | undefined;

    expect(row?.activeCompactId).toBe("cmp-9");
  });

  it("deletes compactions when the session is deleted", () => {
    insertCompaction(db, {
      id: "cmp-1",
      sessionId: "session-1",
      boundaryMessageId: "msg-1",
      summaryText: "Summary text",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: null,
      createdAt: 100,
    });

    deleteSession(db, "session-1");

    expect(getCompaction(db, "cmp-1")).toBeNull();
  });
});
