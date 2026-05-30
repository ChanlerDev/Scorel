"use client";

import type { Turn } from "../../lib/events/projector";

export type TurnUserProps = {
  turn: Turn & { kind: "user" };
};

export function TurnUser({ turn }: TurnUserProps): JSX.Element {
  const text = turn.parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("");
  return (
    <article
      data-testid="turn-user"
      data-pending={turn.pending ? "true" : undefined}
      className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800"
    >
      <header className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        You{turn.pending ? " · sending…" : ""}
      </header>
      <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>
    </article>
  );
}
