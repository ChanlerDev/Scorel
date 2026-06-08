import { useState } from "react";

import { Markdown } from "../Markdown.js";
import type { ToolBlockProps } from "./registry.js";

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DefaultJsonBlock({ call, result, pending }: ToolBlockProps) {
  const isError = Boolean(result?.isError);
  const [open, setOpen] = useState<boolean>(isError);
  const callBody = "```json\n" + safeStringify(call.args) + "\n```";
  const resultBody = result ? "```json\n" + safeStringify(result.result) + "\n```" : null;
  return (
    <div className={`tool-block${isError ? " tool-block--error" : ""}`}>
      <button
        type="button"
        className="tool-block__header"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-block__title">
          <span className="tool-block__title-text">
            {call.toolName}
            {pending ? " · pending" : ""}
            {isError ? " · error" : ""}
          </span>
        </span>
        <span className="tool-block__toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="tool-block__body">
          <Markdown text={callBody} />
          {resultBody ? <Markdown text={resultBody} /> : null}
        </div>
      ) : null}
    </div>
  );
}
