export type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  Static,
  TextContent,
  Tool,
  ToolCall,
  ToolResultMessage,
  TSchema,
  Usage
} from "@earendil-works/pi-ai";

import type { Model } from "@earendil-works/pi-ai";

export {
  createAssistantMessageEventStream,
  getModels,
  getProviders,
  getModel,
  streamSimple,
  StringEnum,
  Type,
  validateToolArguments,
  validateToolCall
} from "@earendil-works/pi-ai";

export function createOpenAICompatibleChatModel(options: {
  id: string;
  baseUrl: string;
  provider?: string;
  name?: string;
  metadata?: Partial<Model<"openai-completions">>;
}): Model<"openai-completions"> {
  const provider = options.provider ?? "openai";
  const isOfficialOpenAI = provider === "openai" && options.baseUrl.includes("api.openai.com");
  return {
    id: options.id,
    name: options.name ?? options.id,
    api: "openai-completions",
    provider,
    baseUrl: options.baseUrl,
    reasoning: options.metadata?.reasoning ?? false,
    input: options.metadata?.input ?? ["text"],
    cost: options.metadata?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: options.metadata?.contextWindow ?? 128000,
    maxTokens: options.metadata?.maxTokens ?? 4096,
    compat: isOfficialOpenAI
      ? undefined
      : options.metadata?.compat ?? {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens",
          requiresToolResultName: true,
          supportsStrictMode: false
        }
  };
}
