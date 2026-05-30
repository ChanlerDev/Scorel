"use client";

import { useEffect, useRef } from "react";

import type { Turn, TurnPart } from "../../lib/events/projector";
import { TurnAssistant } from "./turn-assistant";
import { TurnTool } from "./turn-tool";
import { TurnUser } from "./turn-user";

export type TranscriptProps = {
  turns: Turn[];
};

const SCROLL_BOTTOM_THRESHOLD_PX = 64;

export function Transcript({ turns }: TranscriptProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user has scrolled away from the bottom; if not we
  // pin to bottom on every event.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onScroll = (): void => {
      const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
      stickToBottomRef.current = remaining < SCROLL_BOTTOM_THRESHOLD_PX;
    };
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (stickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm italic text-zinc-500">
        No messages yet — type below to start.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="transcript"
      className="flex h-full flex-col gap-3 overflow-y-auto px-2 py-3"
    >
      {turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} />
      ))}
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }): JSX.Element {
  if (turn.kind === "user") return <TurnUser turn={turn} />;
  if (turn.kind === "assistant") return <TurnAssistant turn={turn} />;
  // standalone tool turn
  return (
    <article
      data-testid="turn-tool-standalone"
      className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800"
    >
      <header className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Tool</header>
      <div className="space-y-2">
        {turn.parts.map((part, idx) =>
          part.kind === "tool_call" || part.kind === "tool_result" ? (
            <TurnTool key={idx} part={part as Extract<TurnPart, { kind: "tool_call" } | { kind: "tool_result" }>} />
          ) : null,
        )}
      </div>
    </article>
  );
}
