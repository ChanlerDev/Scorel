import { AutoscrollRegion } from "./AutoscrollRegion.js";
import type { Turn } from "./projector.js";
import { TurnAssistant } from "./TurnAssistant.js";
import { TurnHarness } from "./TurnHarness.js";
import { TurnUser } from "./TurnUser.js";
import { ToolBlock } from "./tool-blocks/ToolBlock.js";

export type TranscriptProps = {
  turns: Turn[];
};

export function Transcript({ turns }: TranscriptProps) {
  if (turns.length === 0) {
    return (
      <AutoscrollRegion tickKey="empty">
        <div className="transcript__empty">
          <span>No messages yet — type below to start.</span>
        </div>
      </AutoscrollRegion>
    );
  }
  return (
    <AutoscrollRegion tickKey={transcriptTickKey(turns)}>
      <div className="transcript__inner">
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

function TurnView({ turn }: { turn: Turn }) {
  if (turn.kind === "user") return <TurnUser turn={turn} />;
  if (turn.kind === "assistant") return <TurnAssistant turn={turn} />;
  if (turn.kind === "harness") return <TurnHarness turn={turn} />;
  // standalone tool turn (no parent assistant call)
  return (
    <article>
      {turn.parts.map((part, idx) =>
        part.kind === "tool_result" ? (
          <ToolBlock
            key={idx}
            call={{
              type: "tool_call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: {},
            }}
            result={{
              type: "tool_result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: part.result,
              ...(part.isError ? { isError: true } : {}),
            }}
            pending={false}
          />
        ) : null,
      )}
    </article>
  );
}
