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
      className={`rounded border px-2 py-1 text-xs ${
        isError ? "border-red-300 bg-red-50" : "border-zinc-300 bg-white"
      }`}
    >
      <header className="flex items-center justify-between gap-2 text-zinc-600">
        <span className="font-mono">
          {label}
          {isError ? " · error" : ""}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-xs text-zinc-500 underline hover:text-zinc-800"
        >
          {open ? "Hide details" : "Show details"}
        </button>
      </header>
      {open ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100">
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
