import type Database from "better-sqlite3";
import type { TodoItem, TodoStatus } from "../../shared/types.js";

type TodoRow = {
  id: string;
  session_id: string;
  title: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

function isTodoStatus(value: string): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "done";
}

function rowToTodoItem(row: TodoRow): TodoItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    status: isTodoStatus(row.status) ? row.status : "pending",
    notes: typeof row.notes === "string" ? row.notes : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTodo(
  db: Database.Database,
  todo: { id: string; sessionId: string; title: string; notes?: string },
): TodoItem {
  const ts = Date.now();
  db.prepare(
    `INSERT INTO todos (id, session_id, title, status, notes, created_at, updated_at)
     VALUES (@id, @sessionId, @title, 'pending', @notes, @ts, @ts)`,
  ).run({
    id: todo.id,
    sessionId: todo.sessionId,
    title: todo.title,
    notes: todo.notes ?? null,
    ts,
  });

  return {
    id: todo.id,
    sessionId: todo.sessionId,
    title: todo.title,
    status: "pending",
    notes: todo.notes ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateTodo(
  db: Database.Database,
  opts: { id: string; status?: TodoStatus; title?: string; notes?: string | null },
): TodoItem | null {
  const existing = db.prepare(
    "SELECT * FROM todos WHERE id = ?",
  ).get(opts.id) as TodoRow | undefined;

  if (!existing) return null;

  const ts = Date.now();
  db.prepare(
    `UPDATE todos SET
       status = COALESCE(@status, status),
       title = COALESCE(@title, title),
       notes = CASE WHEN @notesProvided = 1 THEN @notes ELSE notes END,
       updated_at = @ts
     WHERE id = @id`,
  ).run({
    id: opts.id,
    status: opts.status ?? null,
    title: opts.title ?? null,
    notes: opts.notes ?? null,
    notesProvided: Object.prototype.hasOwnProperty.call(opts, "notes") ? 1 : 0,
    ts,
  });

  const updated = db.prepare(
    "SELECT * FROM todos WHERE id = ?",
  ).get(opts.id) as TodoRow;

  return rowToTodoItem(updated);
}

export function deleteTodo(
  db: Database.Database,
  id: string,
): boolean {
  const result = db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listTodos(
  db: Database.Database,
  sessionId: string,
): TodoItem[] {
  const rows = db.prepare(
    `SELECT * FROM todos
     WHERE session_id = ?
     ORDER BY created_at ASC`,
  ).all(sessionId) as TodoRow[];

  return rows.map(rowToTodoItem);
}

export function deleteSessionTodos(
  db: Database.Database,
  sessionId: string,
): void {
  db.prepare("DELETE FROM todos WHERE session_id = ?").run(sessionId);
}
