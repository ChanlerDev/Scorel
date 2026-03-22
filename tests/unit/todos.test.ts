import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../src/main/storage/db.js";
import { createTodo, listTodos, updateTodo } from "../../src/main/storage/todos.js";

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

  it("sanitizes non-string notes returned from DB rows", () => {
    const fakeDb = {
      prepare: () => ({
        all: () => [{
          id: "todo-2",
          session_id: "session-1",
          title: "Investigate review",
          status: "pending",
          notes: 123,
          created_at: 1,
          updated_at: 1,
        }],
      }),
    } as unknown as Database.Database;

    const todos = listTodos(fakeDb, "session-1");

    expect(todos).toEqual([
      expect.objectContaining({
        id: "todo-2",
        notes: null,
      }),
    ]);
  });
});
