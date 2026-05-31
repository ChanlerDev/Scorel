"use client";

import { useState } from "react";

import type { TurnPart } from "../../lib/events/projector";
import { MarkdownView } from "./markdown-view";

export type TurnToolProps = {
  part: Extract<TurnPart, { kind: "tool_call" } | { kind: "tool_result" }>;
};

export function TurnTool({ part }: TurnToolProps): JSX.Element {
  const isCall = part.kind === "tool_call";
  const isError =
    !isCall &&
    Boolean((part as Extract<TurnPart, { kind: "tool_result" }>).isError);
  // Default-collapsed for tool_call. Default-expanded only for tool_result
  // whose isError === true so failures surface immediately. Successful
  // tool_results stay collapsed to keep the transcript scannable.
  const [open, setOpen] = useState<boolean>(isError);
  const label = isCall
    ? `tool_call · ${part.toolName}`
    : `tool_result · ${part.toolName}`;
  const payload = isCall
    ? part.args
    : (part as Extract<TurnPart, { kind: "tool_result" }>).result;
  const fenced = "```json\n" + safeStringify(payload) + "\n```";
  return (
    <div
      data-testid={isCall ? "turn-tool-call" : "turn-tool-result"}
      data-tool-open={open ? "true" : "false"}
      className={`rounded-sm border px-2 py-1 text-xs ${
        isError ? "border-status-err bg-surface" : "border-subtle bg-surface"
      }`}
    >
      <header className="flex items-center justify-between gap-2 text-muted">
        <span className="font-mono">
          {label}
          {isError ? " · error" : ""}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-xs text-text underline hover:opacity-80"
        >
          {open ? "Hide details" : "Show details"}
        </button>
      </header>
      {open ? (
        <div className="mt-1 max-h-96 overflow-auto">
          <MarkdownView text={fenced} />
        </div>
      ) : null}
    </div>
  );
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
