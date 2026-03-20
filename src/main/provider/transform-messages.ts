import { createHash } from "node:crypto";
import type {
  ScorelMessage,
  AssistantMessage,
  ProviderCompat,
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

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string };

export type AnthropicMessage =
  | { role: "user"; content: AnthropicContentBlock[] }
  | { role: "assistant"; content: AnthropicContentBlock[] };

export type AnthropicPayload = {
  system: string;
  messages: AnthropicMessage[];
};

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

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      if (msg.stopReason === "aborted") continue;
      result.push(transformAssistant(msg, compat));
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

// --- Anthropic Transform ---

export function normalizeToolCallId(id: string): string {
  if (id.length <= 64) return id;
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 61);
  return `tc_${hash}`;
}

/**
 * Transform canonical ScorelMessages into Anthropic Messages format.
 *
 * Key differences from OpenAI:
 * - System prompt extracted to top-level `system` (no system role in messages)
 * - assistant.content is content block array (text/tool_use/thinking)
 * - toolResult → tool_result block inside role:"user" message
 * - tool_result blocks before text blocks within same user message
 * - Strict user/assistant alternation enforced
 * - Tool call IDs normalized to ≤64 chars
 */
export function transformMessagesAnthropic(
  systemPrompt: string,
  messages: ScorelMessage[],
  sourceModelId?: string,
): AnthropicPayload {
  // Collect valid toolCallIds from non-aborted assistants
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

  const raw: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      raw.push({ role: "user", content: [{ type: "text", text: msg.content }] });
    } else if (msg.role === "assistant") {
      if (msg.stopReason === "aborted") continue;
      raw.push(transformAssistantAnthropic(msg, sourceModelId));
    } else if (msg.role === "toolResult") {
      if (!validToolCallIds.has(msg.toolCallId)) continue;
      const content = msg.content.map((p) => p.text).join("\n");
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: normalizeToolCallId(msg.toolCallId),
        content,
      };
      if (msg.isError) {
        (block as { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }).is_error = true;
      }
      raw.push({ role: "user", content: [block] });
    }
  }

  // Enforce alternation: merge consecutive same-role messages
  const merged = enforceAlternation(raw);

  // Within each user message, reorder: tool_result blocks before text blocks
  for (const msg of merged) {
    if (msg.role === "user") {
      reorderUserContent(msg.content);
    }
  }

  return { system: systemPrompt, messages: merged };
}

function transformAssistantAnthropic(
  msg: AssistantMessage,
  sourceModelId?: string,
): AnthropicMessage {
  const content: AnthropicContentBlock[] = [];

  for (const part of msg.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "toolCall") {
      content.push({
        type: "tool_use",
        id: normalizeToolCallId(part.id),
        name: part.name,
        input: part.arguments,
      });
    } else if (part.type === "thinking") {
      if (part.redacted) continue;
      if (sourceModelId && msg.modelId === sourceModelId) {
        const block: AnthropicContentBlock = { type: "thinking", thinking: part.thinking };
        if (part.thinkingSignature) {
          (block as { type: "thinking"; thinking: string; signature?: string }).signature = part.thinkingSignature;
        }
        content.push(block);
      } else {
        content.push({ type: "text", text: part.thinking });
      }
    }
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return { role: "assistant", content };
}

/**
 * Enforce strict user/assistant alternation by merging consecutive same-role messages.
 */
function enforceAlternation(messages: AnthropicMessage[]): AnthropicMessage[] {
  if (messages.length === 0) return [];

  const result: AnthropicMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];

    if (prev.role === curr.role) {
      prev.content.push(...curr.content);
    } else {
      result.push(curr);
    }
  }

  // If first message is assistant, insert empty user bridge
  if (result.length > 0 && result[0].role === "assistant") {
    result.unshift({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return result;
}

/**
 * Reorder user message content: tool_result blocks before text blocks.
 */
function reorderUserContent(content: AnthropicContentBlock[]): void {
  const toolResults: AnthropicContentBlock[] = [];
  const others: AnthropicContentBlock[] = [];

  for (const block of content) {
    if (block.type === "tool_result") {
      toolResults.push(block);
    } else {
      others.push(block);
    }
  }

  content.length = 0;
  content.push(...toolResults, ...others);
}
