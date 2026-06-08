import { Markdown } from "./Markdown.js";
import type { Turn } from "./projector.js";

export type TurnUserProps = {
  turn: Turn & { kind: "user" };
};

export function TurnUser({ turn }: TurnUserProps) {
  const text = turn.parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("");
  return (
    <div className="turn-user">
      <article className="turn-user__bubble" data-pending={turn.pending ? "true" : undefined}>
        <Markdown text={text} />
        {turn.pending ? <span className="turn-user__pending">sending…</span> : null}
      </article>
    </div>
  );
}
