import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../src/main/storage/db.js";
import { createTodo, updateTodo } from "../../src/main/storage/todos.js";

describe("todos storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    db.prepare(
      `INSERT INTO sessions
         (id, title, created_at, updated_at, archived, workspace_root, active_provider_id, active_model_id)
       VALUES (?, NULL, ?, ?, 0, ?, NULL, NULL)`,
    ).run("session-1", 1, 1, "/tmp/workspace");
  });

  it("allows clearing todo notes", () => {
    createTodo(db, {
      id: "todo-1",
      sessionId: "session-1",
      title: "Write tests",
      notes: "temporary notes",
    });

    const updated = updateTodo(db, {
      id: "todo-1",
      notes: null,
    });

    expect(updated?.notes).toBeNull();
  });
});
