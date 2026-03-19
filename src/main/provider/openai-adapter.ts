import { resolveCompat } from "./compat.js";
import { transformMessages } from "./transform-messages.js";
import { EventStreamAccumulator } from "./event-stream.js";
import type { ProviderAdapter, ProviderRequestOptions } from "./types.js";
import type { ProviderConfig, AssistantMessage } from "../../shared/types.js";
import type { AssistantMessageEvent } from "../../shared/events.js";

type OpenAIDelta = {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type OpenAIChunk = {
  choices?: Array<{
    index: number;
    delta: OpenAIDelta;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export const openaiAdapter: ProviderAdapter = {
  api: "openai-chat-completions",

  async stream(
    config: ProviderConfig,
    apiKey: string,
    opts: ProviderRequestOptions,
    onEvent: (event: AssistantMessageEvent) => void,
  ): Promise<AssistantMessage> {
    const compat = resolveCompat(config.compat);
    const openaiMessages = transformMessages(opts.systemPrompt, opts.messages, compat);

    const body: Record<string, unknown> = {
      model: opts.modelId,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }
    if (opts.maxTokens != null) {
      body[compat.maxTokensField] = opts.maxTokens;
    }

    const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.defaultHeaders,
    };
    if (config.auth.type === "bearer") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else if (config.auth.type === "x-api-key") {
      headers[config.auth.headerName ?? "x-api-key"] = apiKey;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const accumulator = new EventStreamAccumulator(
      opts.providerId,
      opts.modelId,
      "openai-chat-completions",
      onEvent,
    );

    let lastFinishReason = "stop";

    try {
      await parseSSEStream(response, opts.signal, (chunk: OpenAIChunk) => {
        if (chunk.usage) {
          accumulator.setUsage(chunk.usage);
        }

        if (!chunk.choices || chunk.choices.length === 0) return;

        const choice = chunk.choices[0];

        if (choice.delta.content) {
          accumulator.pushTextDelta(choice.delta.content);
        }

        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            accumulator.pushToolCallDelta(
              tc.index,
              tc.id,
              tc.function?.name,
              tc.function?.arguments,
            );
          }
        }

        if (choice.finish_reason) {
          lastFinishReason = choice.finish_reason;
        }
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return accumulator.abort();
      }
      throw err;
    }

    return accumulator.finalize(lastFinishReason);
  },
};

async function parseSSEStream(
  response: Response,
  signal: AbortSignal | undefined,
  onChunk: (chunk: OpenAIChunk) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("Response body is null");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        if (trimmed === "data: [DONE]") return;
        if (!trimmed.startsWith("data: ")) continue;

        const json = trimmed.slice(6);
        try {
          const chunk = JSON.parse(json) as OpenAIChunk;
          onChunk(chunk);
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
