import { Check, Loader, Square } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  content?: string;
  status?: TodoStatus;
  activeForm?: string;
};

type TodoArgs = { todos?: TodoItem[] };

export function TodoWriteBlock({ call, result, pending }: ToolBlockProps) {
  const args = (call.args ?? {}) as TodoArgs;
  const todos = Array.isArray(args.todos) ? args.todos : [];
  const completed = todos.filter((todo) => todo.status === "completed").length;

  return (
    <div className={`tool-block${result?.isError ? " tool-block--error" : ""}`}>
      <div className="tool-block__header" style={{ cursor: "default" }}>
        <span className="tool-block__title">
          <span className="tool-block__title-text">
            任务列表 ({completed} / {todos.length})
            {pending ? " · pending" : ""}
          </span>
        </span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {todos.length === 0 ? (
          <li className="modal__hint">空</li>
        ) : (
          todos.map((todo, idx) => {
            const status = todo.status ?? "pending";
            const text = todo.content ?? "";
            const muted = status === "completed";
            return (
              <li
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px minmax(0, 1fr)",
                  gap: 8,
                  alignItems: "center",
                  fontSize: "var(--text-sm)",
                  color: muted ? "var(--color-text-muted)" : "var(--color-text)",
                  textDecoration: muted ? "line-through" : "none",
                }}
              >
                <StatusIcon status={status} />
                <span>{text}</span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") return <Check size={14} color="var(--color-status-ok)" />;
  if (status === "in_progress") return <Loader size={14} className="scorel-spin" />;
  return <Square size={14} color="var(--color-text-faint)" />;
}
