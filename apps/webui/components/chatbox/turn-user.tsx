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
    <div className="flex justify-end px-4">
      <article
        data-testid="turn-user"
        data-pending={turn.pending ? "true" : undefined}
        className="max-w-[70%] rounded-lg bg-accent-soft px-4 py-3 text-md text-text"
      >
        <MarkdownView text={text} />
        {turn.pending ? (
          <span className="mt-1 block text-xs text-faint">sending…</span>
        ) : null}
      </article>
    </div>
  );
}
