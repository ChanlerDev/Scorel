import type {
  ScorelMessage,
  AssistantMessage,
  ProviderCompat,
  ContentPart,
} from "../../shared/types.js";

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIMessage =
  | { role: "system" | "developer"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string; name?: string };

/**
 * Transform canonical ScorelMessages into OpenAI Chat Completions message array.
 *
 * Key invariants:
 * - assistant.content is always a plain string (never content-part array) — prevents pi #2007
 * - aborted assistants are excluded entirely
 * - orphan toolResults (whose toolCallId doesn't match a preceding non-aborted assistant) are excluded
 */
export function transformMessages(
  systemPrompt: string,
  messages: ScorelMessage[],
  compat: Required<ProviderCompat>,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // System prompt
  if (systemPrompt) {
    const role = compat.supportsDeveloperRole ? "developer" : "system";
    result.push({ role, content: systemPrompt });
  }

  // Collect valid toolCallIds from non-aborted assistants for orphan detection
  const validToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.stopReason !== "aborted") {
      for (const part of msg.content) {
        if (part.type === "toolCall") {
          validToolCallIds.add(part.id);
        }
      }
    }
  }

  let lastRole: string | undefined;

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      lastRole = "user";
    } else if (msg.role === "assistant") {
      if (msg.stopReason === "aborted") continue;
      result.push(transformAssistant(msg, compat));
      lastRole = "assistant";
    } else if (msg.role === "toolResult") {
      // Exclude orphan toolResults
      if (!validToolCallIds.has(msg.toolCallId)) continue;

      const content = msg.content.map((p) => p.text).join("\n");
      const toolMsg: OpenAIMessage = {
        role: "tool",
        tool_call_id: msg.toolCallId,
        content,
      };
      if (compat.requiresToolResultName) {
        (toolMsg as { role: "tool"; tool_call_id: string; content: string; name?: string }).name =
          msg.toolName;
      }
      result.push(toolMsg);
      lastRole = "tool";
    }
  }

  // Insert bridge assistant messages between tool results and user messages
  if (compat.requiresAssistantAfterToolResult) {
    insertBridgeMessages(result);
  }

  return result;
}

function transformAssistant(
  msg: AssistantMessage,
  compat: Required<ProviderCompat>,
): OpenAIMessage {
  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const part of msg.content) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else if (part.type === "toolCall") {
      toolCalls.push({
        id: part.id,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.arguments),
        },
      });
    } else if (part.type === "thinking") {
      if (compat.requiresThinkingAsText && !part.redacted) {
        textParts.push(part.thinking);
      }
      // Otherwise omit thinking from OpenAI output
    }
  }

  const content = textParts.length > 0 ? textParts.join("\n") : null;
  const result: OpenAIMessage = { role: "assistant", content };
  if (toolCalls.length > 0) {
    (result as { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }).tool_calls =
      toolCalls;
  }
  return result;
}

/**
 * Insert synthetic `{ role: "assistant", content: "" }` between consecutive
 * tool result and user messages (some providers require this).
 */
function insertBridgeMessages(result: OpenAIMessage[]): void {
  for (let i = result.length - 1; i > 0; i--) {
    if (result[i].role === "user" && result[i - 1].role === "tool") {
      result.splice(i, 0, { role: "assistant", content: "" });
    }
  }
}
