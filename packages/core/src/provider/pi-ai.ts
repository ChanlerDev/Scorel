import {
  Type,
  getModels,
  streamSimple,
  type Api,
  type Context,
  type KnownProvider,
  type Message,
  type Model,
  type TextContent,
  type ThinkingContent,
  type Tool,
  type ToolCall,
  type Usage as PiUsage,
} from "@mariozechner/pi-ai";

import type {
  ContentBlock,
  ScorelMessage,
  StopReason,
  ToolCallContentBlock,
  ToolResultContentBlock,
  Usage,
} from "@scorel/protocol";

import type { BuiltinPiAiModelConfig, CustomPiAiApi, CustomPiAiModelConfig } from "../config/index.js";
import type { RuntimeProvider } from "../runtime/index.js";
import type { AgentTool } from "../tools/index.js";

export type PiAiProviderOptions = {
  model: Model<Api>;
  apiKey: string;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
};

export const createPiAiProvider = (options: PiAiProviderOptions): RuntimeProvider => ({
  streamTurn: async function* ({ context, systemPrompt, tools, signal }) {
    const stream = streamSimple(options.model, toPiContext(context, systemPrompt, tools), {
      apiKey: options.apiKey,
      signal,
      ...(options.reasoning ? { reasoning: options.reasoning } : {}),
      ...(options.onPayload ? { onPayload: options.onPayload } : {}),
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        yield { type: "text_delta", delta: event.delta };
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
      reasoning: config.reasoning,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.contextWindow,
      maxTokens: config.maxTokens,
      ...(config.api === "openai-completions"
        ? { compat: { supportsDeveloperRole: config.compat?.supportsDeveloperRole ?? false } }
        : {}),
    } satisfies Model<CustomPiAiApi>;
  }

  const model = getModels(config.provider as KnownProvider).find((candidate) => candidate.id === config.id);
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
          cacheRead: 0,
          cacheWrite: 0,
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
  parameters: toolParameters(tool.name),
});

const toolParameters = (name: string): Tool["parameters"] => {
  switch (name) {
    case "Read":
      return Type.Object({
        file_path: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
        full: Type.Optional(Type.Boolean()),
      });
    case "Write":
      return Type.Object({
        file_path: Type.String(),
        content: Type.String(),
      });
    case "Edit":
      return Type.Object({
        file_path: Type.String(),
        old_string: Type.String(),
        new_string: Type.String(),
        replace_all: Type.Optional(Type.Boolean()),
      });
    case "Bash":
      return Type.Object({
        command: Type.String(),
        cwd: Type.Optional(Type.String()),
        timeout: Type.Optional(Type.Number()),
        description: Type.Optional(Type.String()),
        maxOutputBytes: Type.Optional(Type.Number()),
      });
    case "Glob":
      return Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        head_limit: Type.Optional(Type.Number()),
        offset: Type.Optional(Type.Number()),
      });
    case "Grep":
      return Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        glob: Type.Optional(Type.String()),
        output_mode: Type.Optional(Type.Union([Type.Literal("files"), Type.Literal("content"), Type.Literal("count")])),
        "-B": Type.Optional(Type.Number()),
        "-A": Type.Optional(Type.Number()),
        "-C": Type.Optional(Type.Number()),
        context: Type.Optional(Type.Number()),
        "-n": Type.Optional(Type.Boolean()),
        "-i": Type.Optional(Type.Boolean()),
        type: Type.Optional(Type.String()),
        head_limit: Type.Optional(Type.Number()),
        offset: Type.Optional(Type.Number()),
        multiline: Type.Optional(Type.Boolean()),
      });
    case "TodoWrite":
      return Type.Object({
        todos: Type.Array(
          Type.Object({
            content: Type.String(),
            status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
            activeForm: Type.Optional(Type.String()),
          }),
        ),
      });
    case "Skill":
      return Type.Object({
        name: Type.String(),
        args: Type.Optional(Type.String()),
      });
    default:
      return Type.Object({});
  }
};

const textContent = (message: ScorelMessage): string =>
  message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

const toolResultText = (result: ToolResultContentBlock["result"]): string => {
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
    }
  }
  return JSON.stringify(result);
};

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
    totalTokens: usage.totalTokens,
  };
};
