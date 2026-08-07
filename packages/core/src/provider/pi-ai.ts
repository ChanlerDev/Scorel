import {
  lazyApi,
  type Api,
  type Context,
  type Message,
  type Model,
  type ProviderStreams,
  type TextContent,
  type ThinkingContent,
  type Tool,
  type ToolCall,
  type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import { getBuiltinModels, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all";

import type {
  ContentBlock,
  ReasoningEffort,
  ScorelMessage,
  StopReason,
  SystemReminderContentBlock,
  ToolCallContentBlock,
  ToolResultContentBlock,
  Usage,
} from "@scorel/protocol";

import type { BuiltinPiAiModelConfig, CustomPiAiApi, CustomPiAiModelConfig } from "../config/index.js";
import type { RuntimeProvider } from "../runtime/index.js";
import { renderSystemReminder } from "../reminders/index.js";
import type { AgentTool } from "../tools/index.js";

export type PiAiProviderOptions = {
  model: Model<Api>;
  apiKey: string;
  reasoning?: ReasoningEffort;
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
};

const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 200_000;
const DEFAULT_CUSTOM_MODEL_MAX_TOKENS = 64_000;

const PI_AI_APIS: Partial<Record<Api, ProviderStreams>> = {
  "anthropic-messages": lazyApi(() => import("@earendil-works/pi-ai/api/anthropic-messages")),
  "azure-openai-responses": lazyApi(() => import("@earendil-works/pi-ai/api/azure-openai-responses")),
  "bedrock-converse-stream": lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream")),
  "google-generative-ai": lazyApi(() => import("@earendil-works/pi-ai/api/google-generative-ai")),
  "google-vertex": lazyApi(() => import("@earendil-works/pi-ai/api/google-vertex")),
  "mistral-conversations": lazyApi(() => import("@earendil-works/pi-ai/api/mistral-conversations")),
  "openai-codex-responses": lazyApi(() => import("@earendil-works/pi-ai/api/openai-codex-responses")),
  "openai-completions": lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions")),
  "openai-responses": lazyApi(() => import("@earendil-works/pi-ai/api/openai-responses")),
};

export const createPiAiProvider = (options: PiAiProviderOptions): RuntimeProvider => ({
  streamTurn: async function* ({ context, systemPrompt, tools, signal }) {
    const model = options.reasoning === "max" || options.reasoning === "xhigh"
      ? {
          ...options.model,
          thinkingLevelMap: {
            ...options.model.thinkingLevelMap,
            [options.reasoning]: options.reasoning,
          },
        }
      : options.model;
    const streamSimple = PI_AI_APIS[model.api]?.streamSimple;
    if (!streamSimple) {
      throw new Error(`Unsupported pi-ai API: ${model.api}`);
    }
    const stream = streamSimple(model, toPiContext(context, systemPrompt, tools), {
      apiKey: options.apiKey,
      signal,
      ...(options.reasoning ? { reasoning: options.reasoning } : {}),
      ...(options.onPayload ? { onPayload: options.onPayload } : {}),
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        yield { type: "text_delta", delta: event.delta };
      } else if (event.type === "thinking_delta") {
        yield { type: "thinking_delta", delta: event.delta };
      }
    }

    return fromPiAssistant(await stream.result());
  },
});

export const resolvePiAiModel = (config: BuiltinPiAiModelConfig | CustomPiAiModelConfig): Model<Api> => {
  if (config.type === "custom") {
    return {
      id: config.id,
      name: config.id,
      api: config.api,
      provider: config.provider,
      baseUrl: config.baseUrl,
      input: config.supportsImageInput ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: config.reasoning ?? false,
      contextWindow: config.contextWindow ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
      maxTokens: config.maxTokens ?? DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
      ...(config.api === "openai-completions"
        ? { compat: { supportsDeveloperRole: config.compat?.supportsDeveloperRole ?? false } }
        : {}),
    } satisfies Model<CustomPiAiApi>;
  }

  const model = getBuiltinModels(config.provider as BuiltinProvider).find((candidate) => candidate.id === config.id);
  if (!model) {
    throw new Error(`Unknown pi-ai model: ${config.provider}/${config.id}`);
  }
  return {
    ...model,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };
};

const toPiContext = (context: ScorelMessage[], systemPrompt: string | undefined, tools: AgentTool[]): Context => ({
  ...(systemPrompt ? { systemPrompt } : {}),
  messages: context.flatMap(toPiMessage),
  tools: tools.map(toPiTool),
});

const toPiMessage = (message: ScorelMessage): Message[] => {
  if (message.role === "system") {
    return [{ role: "user", content: textContent(message), timestamp: Date.now() }];
  }
  if (message.role === "user") {
    return [{ role: "user", content: textContent(message), timestamp: Date.now() }];
  }
  if (message.role === "assistant") {
    return [
      {
        role: "assistant",
        content: message.content.flatMap(toPiAssistantBlock),
        api: stringMeta(message, "api") ?? "openai-completions",
        provider: stringMeta(message, "provider") ?? "scorel",
        model: stringMeta(message, "model") ?? "unknown",
        usage: {
          input: message.usage?.inputTokens ?? 0,
          output: message.usage?.outputTokens ?? 0,
          cacheRead: message.usage?.cacheReadTokens ?? 0,
          cacheWrite: message.usage?.cacheWriteTokens ?? 0,
          totalTokens: message.usage?.totalTokens ?? 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: toPiStopReason(message.stopReason),
        timestamp: Date.now(),
      },
    ];
  }

  return message.content.flatMap((block): Message[] => {
    if (block.type !== "tool_result") {
      return [];
    }
    return [
      {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        content: [{ type: "text", text: toolResultText(block.result) }],
        isError: block.isError ?? false,
        timestamp: Date.now(),
      },
    ];
  });
};

const toPiAssistantBlock = (block: ContentBlock): Array<TextContent | ThinkingContent | ToolCall> => {
  if (block.type === "text") {
    return [{ type: "text", text: block.text }];
  }
  if (block.type === "system_reminder") {
    return [{ type: "text", text: renderSystemReminder(block) }];
  }
  if (block.type === "thinking") {
    return [{ type: "thinking", thinking: block.text }];
  }
  if (block.type === "tool_call") {
    return [{ type: "toolCall", id: block.toolCallId, name: block.toolName, arguments: block.args as Record<string, unknown> }];
  }
  return [];
};

const fromPiAssistant = (message: Extract<Message, { role: "assistant" }>): ScorelMessage & { role: "assistant" } => ({
  role: "assistant",
  content: message.content.map(fromPiContentBlock),
  stopReason: fromPiStopReason(message.stopReason),
  usage: fromPiUsage(message.usage),
  meta: {
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
    ...(message.diagnostics ? { diagnostics: message.diagnostics } : {}),
  },
});

const fromPiContentBlock = (block: Extract<Message, { role: "assistant" }>["content"][number]): ContentBlock => {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking") {
    return { type: "thinking", text: block.thinking };
  }
  return {
    type: "tool_call",
    toolCallId: block.id,
    toolName: block.name,
    args: block.arguments,
  };
};

const toPiTool = (tool: AgentTool): Tool => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
});

const textContent = (message: ScorelMessage): string =>
  message.content.flatMap((block) => {
    if (block.type === "text") {
      return [block.text];
    }
    if (block.type === "system_reminder") {
      return [renderSystemReminder(block)];
    }
    return [];
  }).join("\n");

const toolResultText = (result: ToolResultContentBlock["result"]): string => {
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .flatMap((block): string[] => {
          if (block?.type === "text" && typeof block.text === "string") {
            return [block.text];
          }
          if (isSystemReminderContentBlock(block)) {
            return [renderSystemReminder(block)];
          }
          return [];
        })
        .join("\n");
    }
  }
  return JSON.stringify(result);
};

const isSystemReminderContentBlock = (value: unknown): value is SystemReminderContentBlock =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "system_reminder" &&
  typeof (value as { text?: unknown }).text === "string";

const stringMeta = (message: ScorelMessage, key: string): string | undefined => {
  const value = message.meta?.[key];
  return typeof value === "string" ? value : undefined;
};

const toPiStopReason = (reason: StopReason | undefined): Extract<Message, { role: "assistant" }>["stopReason"] => {
  if (reason === "tool_call") {
    return "toolUse";
  }
  if (reason === "max_tokens") {
    return "length";
  }
  if (reason === "cancelled") {
    return "aborted";
  }
  if (reason === "error") {
    return "error";
  }
  return "stop";
};

const fromPiStopReason = (reason: Extract<Message, { role: "assistant" }>["stopReason"]): StopReason => {
  if (reason === "toolUse") {
    return "tool_call";
  }
  if (reason === "length") {
    return "max_tokens";
  }
  if (reason === "aborted") {
    return "cancelled";
  }
  if (reason === "error") {
    return "error";
  }
  return "end_turn";
};

const fromPiUsage = (usage: PiUsage | undefined): Usage | undefined => {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
};
