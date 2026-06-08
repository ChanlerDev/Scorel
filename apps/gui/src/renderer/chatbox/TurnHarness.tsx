import type { Turn } from "./projector.js";

export type TurnHarnessProps = {
  turn: Turn & { kind: "harness" };
};

export function TurnHarness({ turn }: TurnHarnessProps) {
  const text = turn.parts.map((part) => part.text).join("\n");
  return (
    <article className="turn-harness">
      <header>{turn.label}</header>
      <p>{text}</p>
    </article>
  );
}
