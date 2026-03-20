import { randomBytes } from "node:crypto";
import type { Api, AssistantMessage, ThinkingPart, ToolCallPart } from "../../shared/types.js";
import type { AssistantMessageEvent } from "../../shared/events.js";
import { NANOID_LENGTH } from "../../shared/constants.js";

const URL_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

function generateId(): string {
  const bytes = randomBytes(NANOID_LENGTH);
  let id = "";
  for (let i = 0; i < NANOID_LENGTH; i++) {
    id += URL_ALPHABET[bytes[i] & 63];
  }
  return id;
}

type ToolCallAccum = {
  id: string;
  name: string;
  args: string;
  contentIndex: number;
};

export class EventStreamAccumulator {
  private readonly _msg: AssistantMessage;
  private readonly _onEvent: (event: AssistantMessageEvent) => void;
  private readonly _toolCalls = new Map<number, ToolCallAccum>();
  private _started = false;
  private _finalized = false;
  private _openTextIndex: number | null = null;
  private _openThinkingIndex: number | null = null;

  constructor(
    providerId: string,
    modelId: string,
    api: Api,
    onEvent: (event: AssistantMessageEvent) => void,
  ) {
    this._onEvent = onEvent;
    this._msg = {
      role: "assistant",
      id: generateId(),
      api,
      providerId,
      modelId,
      content: [],
      stopReason: "stop",
      ts: Date.now(),
    };
  }

  get partial(): AssistantMessage {
    return this._snapshot();
  }

  pushThinkingDelta(delta: string, signature?: string): void {
    this._ensureStarted();

    if (this._openThinkingIndex !== null) {
      const part = this._msg.content[this._openThinkingIndex] as ThinkingPart;
      part.thinking += delta;
    } else {
      const newPart: ThinkingPart = { type: "thinking", thinking: delta };
      this._msg.content.push(newPart);
      this._openThinkingIndex = this._msg.content.length - 1;
    }

    if (signature !== undefined) {
      const part = this._msg.content[this._openThinkingIndex] as ThinkingPart;
      part.thinkingSignature = signature;
    }

    this._emit({
      type: "thinking_delta",
      contentIndex: this._openThinkingIndex,
      delta,
      partial: this._snapshot(),
    });
  }

  pushTextDelta(delta: string): void {
    this._ensureStarted();

    if (this._openThinkingIndex !== null) {
      this._closeThinking();
    }

    if (this._openTextIndex !== null) {
      const part = this._msg.content[this._openTextIndex];
      if (part.type === "text") {
        part.text += delta;
      }
    } else {
      this._msg.content.push({ type: "text", text: delta });
      this._openTextIndex = this._msg.content.length - 1;
    }

    this._emit({
      type: "text_delta",
      contentIndex: this._openTextIndex!,
      delta,
      partial: this._snapshot(),
    });
  }

  pushToolCallDelta(index: number, id?: string, name?: string, argsDelta?: string): void {
    this._ensureStarted();

    // Close open thinking/text parts when tool calls start
    if (this._openThinkingIndex !== null) {
      this._closeThinking();
    }
    if (this._openTextIndex !== null) {
      this._closeText();
    }

    let accum = this._toolCalls.get(index);
    if (!accum) {
      // Create placeholder in content array
      const contentIndex = this._msg.content.length;
      const placeholder: ToolCallPart = {
        type: "toolCall",
        id: id ?? "",
        name: name ?? "",
        arguments: {},
      };
      this._msg.content.push(placeholder);
      accum = { id: id ?? "", name: name ?? "", args: "", contentIndex };
      this._toolCalls.set(index, accum);
    } else {
      if (id) accum.id = id;
      if (name) accum.name += name;
    }

    if (argsDelta) {
      accum.args += argsDelta;
    }

    // Keep placeholder in sync
    const part = this._msg.content[accum.contentIndex] as ToolCallPart;
    part.id = accum.id;
    part.name = accum.name;

    if (argsDelta) {
      this._emit({
        type: "toolcall_delta",
        contentIndex: accum.contentIndex,
        delta: argsDelta,
        partial: this._snapshot(),
      });
    }
  }

  setUsage(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): void {
    this._msg.usage = usage;
  }

  finalize(finishReason: string): AssistantMessage {
    if (this._finalized) return this._snapshot();
    this._finalized = true;
    this._ensureStarted();

    if (this._openThinkingIndex !== null) {
      this._closeThinking();
    }

    if (finishReason === "tool_calls") {
      // Close open text first
      if (this._openTextIndex !== null) {
        this._closeText();
      }

      // Parse and emit each tool call
      for (const [, accum] of this._toolCalls) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(accum.args) as Record<string, unknown>;
        } catch {
          parsed = {};
        }

        const toolCall: ToolCallPart = {
          type: "toolCall",
          id: accum.id,
          name: accum.name,
          arguments: parsed,
        };

        // Update content array with parsed arguments
        this._msg.content[accum.contentIndex] = toolCall;

        this._emit({
          type: "toolcall_end",
          contentIndex: accum.contentIndex,
          toolCall,
          partial: this._snapshot(),
        });
      }

      this._msg.stopReason = "toolUse";
    } else {
      // "stop" or "length"
      if (this._openTextIndex !== null) {
        this._closeText();
      }
      this._msg.stopReason = finishReason === "length" ? "length" : "stop";
    }

    const message = this._snapshot();
    this._emit({ type: "done", reason: message.stopReason, message });
    return message;
  }

  abort(): AssistantMessage {
    if (this._finalized) return this._snapshot();
    this._finalized = true;
    this._ensureStarted();

    // Discard incomplete tool calls and thinking from content
    this._msg.content = this._msg.content.filter((p) => p.type !== "toolCall" && p.type !== "thinking");
    this._toolCalls.clear();
    this._openThinkingIndex = null;

    // Recalculate open text index after filtering shifted indices
    if (this._openTextIndex !== null) {
      this._openTextIndex = this._msg.content.findIndex((p) => p.type === "text");
      if (this._openTextIndex === -1) this._openTextIndex = null;
    }

    // Close open text if any
    if (this._openTextIndex !== null) {
      this._closeText();
    }

    this._msg.stopReason = "aborted";
    const error = this._snapshot();
    this._emit({ type: "error", reason: "aborted", error });
    return error;
  }

  private _ensureStarted(): void {
    if (this._started) return;
    this._started = true;
    this._emit({ type: "start", partial: this._snapshot() });
  }

  private _closeText(): void {
    if (this._openTextIndex === null) return;
    const part = this._msg.content[this._openTextIndex];
    if (part.type === "text") {
      this._emit({
        type: "text_end",
        contentIndex: this._openTextIndex,
        content: part.text,
        partial: this._snapshot(),
      });
    }
    this._openTextIndex = null;
  }

  private _closeThinking(): void {
    if (this._openThinkingIndex === null) return;
    const part = this._msg.content[this._openThinkingIndex] as ThinkingPart;
    this._emit({
      type: "thinking_end",
      contentIndex: this._openThinkingIndex,
      content: part.thinking,
      partial: this._snapshot(),
    });
    this._openThinkingIndex = null;
  }

  private _snapshot(): AssistantMessage {
    return structuredClone(this._msg);
  }

  private _emit(event: AssistantMessageEvent): void {
    this._onEvent(event);
  }
}

/**
 * Parse Server-Sent Events from a streaming Response.
 * Calls onEvent for each complete event (data + optional event type).
 * Handles OpenAI-style "data: [DONE]" termination.
 */
export async function parseSSEStream(
  response: Response,
  signal: AbortSignal | undefined,
  onEvent: (eventType: string | null, data: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("Response body is null");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType: string | null = null;

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") {
          // Empty line = event boundary, reset event type
          currentEventType = null;
          continue;
        }
        if (trimmed === "data: [DONE]") return;
        if (trimmed.startsWith("event: ")) {
          currentEventType = trimmed.slice(7).trim();
          continue;
        }
        if (!trimmed.startsWith("data: ")) continue;

        const json = trimmed.slice(6);
        onEvent(currentEventType, json);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
