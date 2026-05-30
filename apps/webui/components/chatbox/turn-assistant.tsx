"use client";

import type { Turn, TurnPart } from "../../lib/events/projector";
import { TurnTool } from "./turn-tool";

export type TurnAssistantProps = {
  turn: Turn & { kind: "assistant" };
};

export function TurnAssistant({ turn }: TurnAssistantProps): JSX.Element {
  return (
    <article
      data-testid="turn-assistant"
      data-streaming={turn.streaming ? "true" : "false"}
      className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800"
    >
      <header className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
        <span>Assistant</span>
        {turn.streaming ? (
          <span data-testid="streaming-cursor" className="text-zinc-400">
            ▋
          </span>
        ) : null}
        {turn.stopReason && turn.stopReason !== "end_turn" ? (
          <span className="text-amber-600">{turn.stopReason}</span>
        ) : null}
      </header>
      <div className="space-y-2">
        {turn.parts.map((part, idx) => (
          <PartView key={idx} part={part} />
        ))}
      </div>
    </article>
  );
}

function PartView({ part }: { part: TurnPart }): JSX.Element | null {
  if (part.kind === "text") {
    return (
      <pre className="whitespace-pre-wrap font-sans text-sm">{part.text}</pre>
    );
  }
  if (part.kind === "tool_call" || part.kind === "tool_result") {
    return <TurnTool part={part} />;
  }
  if (part.kind === "error") {
    return (
      <p
        data-testid="error-part"
        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
      >
        Error{part.code ? ` (${part.code})` : ""}: {part.message}
      </p>
    );
  }
  return null;
}
