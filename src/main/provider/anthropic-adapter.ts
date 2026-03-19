import { transformMessagesAnthropic } from "./transform-messages.js";
import { EventStreamAccumulator, parseSSEStream } from "./event-stream.js";
import type { ProviderAdapter, ProviderRequestOptions, ToolDefinition } from "./types.js";
import type { ProviderConfig, AssistantMessage } from "../../shared/types.js";
import type { AssistantMessageEvent } from "../../shared/events.js";

type AnthropicSSE =
  | { type: "message_start"; message: { usage?: { input_tokens: number; output_tokens: number } } }
  | { type: "content_block_start"; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: "content_block_delta"; index: number; delta: { type: string; text?: string; partial_json?: string; thinking?: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: string }; usage?: { output_tokens: number } }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: { type: string; message: string } };

type BlockType = "text" | "tool_use" | "thinking";

type BlockState = {
  type: BlockType;
  id?: string;
  name?: string;
};

function convertTools(tools: ToolDefinition[]): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export const anthropicAdapter: ProviderAdapter = {
  api: "anthropic-messages",

  async stream(
    config: ProviderConfig,
    apiKey: string,
    opts: ProviderRequestOptions,
    onEvent: (event: AssistantMessageEvent) => void,
  ): Promise<AssistantMessage> {
    const payload = transformMessagesAnthropic(opts.systemPrompt, opts.messages, opts.modelId);

    const body: Record<string, unknown> = {
      model: opts.modelId,
      system: payload.system,
      messages: payload.messages,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = convertTools(opts.tools);
    }

    const url = `${config.baseUrl.replace(/\/$/, "")}/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...config.defaultHeaders,
    };
    if (config.auth.type === "x-api-key") {
      headers[config.auth.headerName ?? "x-api-key"] = apiKey;
    } else if (config.auth.type === "bearer") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
    }

    const accumulator = new EventStreamAccumulator(
      opts.providerId,
      opts.modelId,
      "anthropic-messages",
      onEvent,
    );

    // Track block types by index for delta dispatch
    const blocks = new Map<number, BlockState>();
    let stopReason = "stop";

    try {
      await parseSSEStream(response, opts.signal, (eventType: string | null, data: string) => {
        let sse: AnthropicSSE;
        try {
          sse = JSON.parse(data) as AnthropicSSE;
        } catch {
          return;
        }

        // Use eventType from SSE header if present, otherwise fall back to sse.type
        const type = eventType ?? sse.type;

        switch (type) {
          case "message_start": {
            const msg = (sse as { type: "message_start"; message: { usage?: { input_tokens: number; output_tokens: number } } }).message;
            if (msg.usage) {
              accumulator.setUsage({
                prompt_tokens: msg.usage.input_tokens,
                completion_tokens: msg.usage.output_tokens,
                total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
              });
            }
            break;
          }

          case "content_block_start": {
            const event = sse as { type: "content_block_start"; index: number; content_block: { type: string; id?: string; name?: string } };
            const blockType = event.content_block.type as BlockType;
            blocks.set(event.index, {
              type: blockType,
              id: event.content_block.id,
              name: event.content_block.name,
            });
            // For tool_use, emit the initial delta with id and name
            if (blockType === "tool_use") {
              accumulator.pushToolCallDelta(
                event.index,
                event.content_block.id,
                event.content_block.name,
                undefined,
              );
            }
            break;
          }

          case "content_block_delta": {
            const event = sse as { type: "content_block_delta"; index: number; delta: { type: string; text?: string; partial_json?: string; thinking?: string } };
            const block = blocks.get(event.index);
            if (!block) break;

            if (block.type === "text" && event.delta.text) {
              accumulator.pushTextDelta(event.delta.text);
            } else if (block.type === "tool_use" && event.delta.partial_json) {
              accumulator.pushToolCallDelta(event.index, undefined, undefined, event.delta.partial_json);
            } else if (block.type === "thinking" && event.delta.thinking) {
              accumulator.pushThinkingDelta(event.delta.thinking);
            }
            break;
          }

          case "content_block_stop": {
            // Block close is handled implicitly by the next block or finalize
            break;
          }

          case "message_delta": {
            const event = sse as { type: "message_delta"; delta: { stop_reason?: string }; usage?: { output_tokens: number } };
            if (event.delta.stop_reason) {
              // Map Anthropic stop reasons to OpenAI-style for the finalize method
              const reason = event.delta.stop_reason;
              if (reason === "end_turn") stopReason = "stop";
              else if (reason === "max_tokens") stopReason = "length";
              else if (reason === "tool_use") stopReason = "tool_calls";
              else stopReason = reason;
            }
            if (event.usage) {
              // Update completion tokens
              const existing = accumulator.partial.usage;
              accumulator.setUsage({
                prompt_tokens: existing?.prompt_tokens ?? 0,
                completion_tokens: event.usage.output_tokens,
                total_tokens: (existing?.prompt_tokens ?? 0) + event.usage.output_tokens,
              });
            }
            break;
          }

          case "message_stop":
          case "ping":
            break;

          case "error": {
            const event = sse as { type: "error"; error: { type: string; message: string } };
            throw new Error(`Anthropic stream error: ${event.error.type}: ${event.error.message}`);
          }
        }
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return accumulator.abort();
      }
      throw err;
    }

    return accumulator.finalize(stopReason);
  },
};
