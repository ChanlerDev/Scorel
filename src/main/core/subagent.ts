import type { AssistantMessage, ScorelMessage, SessionMeta, ToolResult } from "../../shared/types.js";
import { SUBAGENT_DEFAULT_MAX_TURNS } from "../../shared/constants.js";

export function canSpawnSubagent(session: SessionMeta): boolean {
  return session.parentSessionId == null;
}

export function getSubagentMaxTurns(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : SUBAGENT_DEFAULT_MAX_TURNS;
}

export function summarizeChildMessages(messages: ScorelMessage[]): string {
  const lastAssistant = [...messages].reverse().find(
    (message): message is AssistantMessage => message.role === "assistant",
  );
  if (!lastAssistant) {
    return "Subagent completed without a final assistant message.";
  }

  const text = lastAssistant.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (text.length === 0) {
    return "Subagent completed, but the final assistant message had no text content.";
  }

  return text.length > 4_000 ? `${text.slice(0, 4_000)}\n...[truncated]` : text;
}

export function makeSubagentErrorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    isError: true,
    content: message,
  };
}
