import { Markdown } from "./Markdown.js";
import type { Turn, TurnPart } from "./projector.js";
import { StreamingCursor } from "./StreamingCursor.js";
import { ToolBlock } from "./tool-blocks/ToolBlock.js";

export type TurnAssistantProps = {
  turn: Turn & { kind: "assistant" };
};

export function TurnAssistant({ turn }: TurnAssistantProps) {
  const callIndex = new Map<string, Extract<TurnPart, { kind: "tool_call" }>>();
  const resultIndex = new Map<string, Extract<TurnPart, { kind: "tool_result" }>>();
  for (const part of turn.parts) {
    if (part.kind === "tool_call") callIndex.set(part.toolCallId, part);
    if (part.kind === "tool_result") resultIndex.set(part.toolCallId, part);
  }

  return (
    <article className="turn-assistant" data-streaming={turn.streaming ? "true" : "false"}>
      {turn.stopReason && turn.stopReason !== "end_turn" ? (
        <p className="turn-assistant__warn">{turn.stopReason}</p>
      ) : null}
      {turn.parts.map((part, idx) => (
        <PartView
          key={idx}
          part={part}
          resultIndex={resultIndex}
        />
      ))}
      {turn.streaming ? <StreamingCursor /> : null}
    </article>
  );
}

function PartView({
  part,
  resultIndex,
}: {
  part: TurnPart;
  resultIndex: Map<string, Extract<TurnPart, { kind: "tool_result" }>>;
}) {
  if (part.kind === "text") {
    return <Markdown text={part.text} />;
  }
  if (part.kind === "thinking") {
    return (
      <details className="turn-thinking">
        <summary>Thinking…</summary>
        <Markdown text={part.text} />
      </details>
    );
  }
  if (part.kind === "tool_call") {
    const result = resultIndex.get(part.toolCallId);
    return (
      <ToolBlock
        call={{
          type: "tool_call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
        }}
        result={
          result
            ? {
                type: "tool_result",
                toolCallId: result.toolCallId,
                toolName: result.toolName,
                result: result.result,
                ...(result.isError ? { isError: true } : {}),
              }
            : undefined
        }
        pending={!result}
      />
    );
  }
  if (part.kind === "tool_result") {
    // Rendered alongside its tool_call sibling; skip standalone render to
    // avoid double display.
    return null;
  }
  if (part.kind === "error") {
    return (
      <p className="error-line">
        Error{part.code ? ` (${part.code})` : ""}: {part.message}
      </p>
    );
  }
  return null;
}
