import { Check, ListTodo, Loader, Square } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  content?: string;
  status?: TodoStatus;
  activeForm?: string;
};

type TodoArgs = { todos?: TodoItem[] };

export function TodoWriteBlock({ call, pending }: ToolBlockProps) {
  const args = (call.args ?? {}) as TodoArgs;
  const todos = Array.isArray(args.todos) ? args.todos : [];
  const completed = todos.filter((todo) => todo.status === "completed").length;

  return (
    <div className="tool-todo">
      <div className="tool-todo__header">
        <ListTodo size={14} />
        <span>
          任务 ({completed}/{todos.length})
          {pending ? <span style={{ color: "var(--color-text-faint)" }}> · pending</span> : null}
        </span>
      </div>
      <ul className="tool-todo__list">
        {todos.length === 0 ? (
          <li style={{ color: "var(--color-text-faint)", fontSize: 13 }}>空</li>
        ) : (
          todos.map((todo, idx) => {
            const status = todo.status ?? "pending";
            const text = todo.content ?? "";
            const completedRow = status === "completed";
            return (
              <li
                key={idx}
                className={`tool-todo__item${completedRow ? " tool-todo__item--completed" : ""}`}
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
  if (status === "completed") return <Check size={13} color="var(--color-status-ok)" />;
  if (status === "in_progress") return <Loader size={13} className="scorel-spin" />;
  return <Square size={13} color="var(--color-text-faint)" />;
}
