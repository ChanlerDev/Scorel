"use client";

import type { Turn } from "../../lib/events/projector";
import { MarkdownView } from "./markdown-view";

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
      className="rounded-md border border-subtle bg-accent-soft p-3 text-sm text-text"
    >
      <header className="mb-1 font-display text-xs uppercase tracking-wide text-muted">
        You{turn.pending ? " · sending…" : ""}
      </header>
      <MarkdownView text={text} />
    </article>
  );
}
