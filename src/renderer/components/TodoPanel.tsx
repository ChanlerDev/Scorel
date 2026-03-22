import { useEffect, useRef, useState } from "react";
import type { TodoItem } from "@shared/types";
import type { AssistantMessageEvent, ScorelEvent } from "@shared/events";

export function shouldApplyTodoLoadResult(hasReceivedEvent: boolean): boolean {
  return !hasReceivedEvent;
}

export function getTodoPanelLoadFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Failed to load todos: ${detail}`;
}

export function TodoPanel({ sessionId }: { sessionId: string }) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasReceivedEventRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hasReceivedEventRef.current = false;

    const load = async () => {
      const nextTodos = await window.scorel.todos.list(sessionId);
      if (!cancelled && shouldApplyTodoLoadResult(hasReceivedEventRef.current)) {
        setTodos(nextTodos);
        setLoadError(null);
      }
    };

    const unsubscribe = window.scorel.chat.onEvent(sessionId, (event: AssistantMessageEvent | ScorelEvent) => {
      if (event.type === "todo.updated") {
        hasReceivedEventRef.current = true;
        setLoadError(null);
        setTodos(event.todos);
      }
    });

    void load().catch((error: unknown) => {
      if (!cancelled) {
        const message = getTodoPanelLoadFailureMessage(error);
        console.error(message, error);
        setLoadError(message);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionId]);

  if (todos.length === 0 && !loadError) {
    return null;
  }

  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-secondary)",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>
        Todos
      </div>
      {loadError ? (
        <div style={{ marginBottom: 8, fontSize: 12, color: "var(--danger)" }}>
          {loadError}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 6 }}>
        {todos.map((todo) => (
          <div
            key={todo.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <span style={{ color: colorForStatus(todo.status), minWidth: 88 }}>
              {labelForStatus(todo.status)}
            </span>
            <span style={{ color: "var(--text-primary)" }}>{todo.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function labelForStatus(status: TodoItem["status"]): string {
  switch (status) {
    case "done":
      return "Done";
    case "in_progress":
      return "In progress";
    default:
      return "Pending";
  }
}

function colorForStatus(status: TodoItem["status"]): string {
  switch (status) {
    case "done":
      return "var(--success)";
    case "in_progress":
      return "var(--accent)";
    default:
      return "var(--text-secondary)";
  }
}
