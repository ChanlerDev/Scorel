"use client";

import type { Turn, TurnPart } from "../../lib/events/projector";
import { MarkdownView } from "./markdown-view";
import { StreamingCursor } from "./streaming-cursor";
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
        {turn.stopReason && turn.stopReason !== "end_turn" ? (
          <span className="text-status-warn">{turn.stopReason}</span>
        ) : null}
      </header>
      <div className="space-y-2">
        {turn.parts.map((part, idx) => (
          <PartView key={idx} part={part} />
        ))}
        {/* The streaming caret lives strictly outside <MarkdownView> so the
         * markdown parser never sees it. Mounting it here (a sibling of the
         * parts) keeps the cursor at the visual end of the streaming text
         * without interleaving into the parsed token tree. */}
        {turn.streaming ? <StreamingCursor /> : null}
      </div>
    </article>
  );
}

function PartView({ part }: { part: TurnPart }): JSX.Element | null {
  if (part.kind === "text") {
    return <MarkdownView text={part.text} />;
  }
  if (part.kind === "thinking") {
    return (
      <details
        data-testid="thinking-part"
        className="my-2 rounded-md border border-subtle bg-surface p-2 text-muted"
      >
        <summary className="cursor-pointer select-none font-display text-sm">
          Thinking…
        </summary>
        <MarkdownView text={part.text} />
      </details>
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
