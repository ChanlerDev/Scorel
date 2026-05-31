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
      className="rounded-md border border-subtle bg-surface p-3 text-sm text-text"
    >
      <header className="mb-1 flex items-center gap-2 font-display text-xs uppercase tracking-wide text-muted">
        <span>Assistant</span>
        {turn.streaming ? (
          <span data-testid="streaming-cursor" className="text-faint">
            ▋
          </span>
        ) : null}
        {turn.stopReason && turn.stopReason !== "end_turn" ? (
          <span className="text-status-warn">{turn.stopReason}</span>
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
        className="rounded border border-status-err bg-surface-raised px-2 py-1 text-xs text-status-err"
      >
        Error{part.code ? ` (${part.code})` : ""}: {part.message}
      </p>
    );
  }
  return null;
}
