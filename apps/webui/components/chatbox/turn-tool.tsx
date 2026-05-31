"use client";

import { useState } from "react";

import type { TurnPart } from "../../lib/events/projector";

export type TurnToolProps = {
  part: Extract<TurnPart, { kind: "tool_call" } | { kind: "tool_result" }>;
};

export function TurnTool({ part }: TurnToolProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const isCall = part.kind === "tool_call";
  const label = isCall ? `tool_call · ${part.toolName}` : `tool_result · ${part.toolName}`;
  const payload = isCall ? part.args : part.result;
  const isError = !isCall && part.isError;
  return (
    <div
      data-testid={isCall ? "turn-tool-call" : "turn-tool-result"}
      className={`rounded-md border px-2 py-1 text-xs ${
        isError
          ? "border-status-err bg-surface-raised"
          : "border-subtle bg-surface-raised"
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
          className="text-xs text-accent underline hover:text-accent-hover"
        >
          {open ? "Hide details" : "Show details"}
        </button>
      </header>
      {open ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface px-2 py-1 font-mono text-xs text-muted">
          {safeStringify(payload)}
        </pre>
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
