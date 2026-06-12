import { Check, ListTodo, Loader, Square } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";

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
  const inProgress = todos.find((todo) => todo.status === "in_progress");

  return (
    <ToolChip
      icon={<ListTodo />}
      title={
        <>
          TodoWrite
          {inProgress?.content ? <span className="tool-chip__status"> · {inProgress.content}</span> : null}
        </>
      }
      counters={<span>{completed}/{todos.length}</span>}
      pending={pending}
      defaultOpen={todos.length > 0}
      body={
        <ul className="tool-todo__list">
          {todos.length === 0 ? (
            <li className="tool-muted-line">空</li>
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
      }
    />
  );
}

function StatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") return <Check size={13} color="var(--color-status-ok)" />;
  if (status === "in_progress") return <Loader size={13} className="scorel-spin" />;
  return <Square size={13} color="var(--color-text-faint)" />;
}
