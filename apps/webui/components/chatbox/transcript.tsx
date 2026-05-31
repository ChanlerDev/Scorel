"use client";

import type { Turn, TurnPart } from "../../lib/events/projector";
import { AutoscrollRegion } from "./autoscroll-region";
import { TurnAssistant } from "./turn-assistant";
import { TurnTool } from "./turn-tool";
import { TurnUser } from "./turn-user";

export type TranscriptProps = {
  turns: Turn[];
};

/**
 * Pure presenter for the projected turn list. Scroll behavior delegates to
 * `<AutoscrollRegion>` (S0042) so this component carries no scroll state.
 *
 * The empty placeholder still mounts inside the region so that the user can
 * scroll-to-bottom even before the first message arrives.
 *
 * `tickKey` is built from turn count plus the last turn's first text part
 * length so that streaming text_delta growth (which keeps `turns.length`
 * stable but extends the last turn's text) still triggers the
 * follow-when-at-bottom auto-scroll effect. The IntersectionObserver gate
 * inside AutoscrollRegion is what actually decides whether to scroll, so
 * this is just a "something visibly changed" pulse.
 */
export function Transcript({ turns }: TranscriptProps): JSX.Element {
  if (turns.length === 0) {
    return (
      <AutoscrollRegion
        tickKey={"empty"}
        className="flex h-full items-center justify-center overflow-y-auto bg-bg text-sm italic text-muted"
      >
        <span data-testid="transcript-empty">
          No messages yet — type below to start.
        </span>
      </AutoscrollRegion>
    );
  }

  return (
    <AutoscrollRegion
      tickKey={transcriptTickKey(turns)}
      className="flex h-full flex-col overflow-y-auto bg-bg"
    >
      <div
        data-testid="transcript"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6"
      >
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
      </div>
    </AutoscrollRegion>
  );
}

function transcriptTickKey(turns: Turn[]): string {
  const last = turns[turns.length - 1];
  if (!last) return `${turns.length}:0`;
  const firstText = last.parts.find((p) => p.kind === "text");
  const len = firstText && firstText.kind === "text" ? firstText.text.length : 0;
  return `${turns.length}:${last.id}:${len}`;
}

function TurnView({ turn }: { turn: Turn }): JSX.Element {
  if (turn.kind === "user") return <TurnUser turn={turn} />;
  if (turn.kind === "assistant") return <TurnAssistant turn={turn} />;
  // standalone tool turn
  return (
    <article
      data-testid="turn-tool-standalone"
      className="px-4 text-md text-text"
    >
      <header className="mb-1 text-xs uppercase tracking-wide text-muted">
        Tool
      </header>
      <div className="space-y-2">
        {turn.parts.map((part, idx) =>
          part.kind === "tool_call" || part.kind === "tool_result" ? (
            <TurnTool
              key={idx}
              part={
                part as Extract<
                  TurnPart,
                  { kind: "tool_call" } | { kind: "tool_result" }
                >
              }
            />
          ) : null,
        )}
      </div>
    </article>
  );
}
