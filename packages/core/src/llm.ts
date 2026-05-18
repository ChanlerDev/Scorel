export type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  Static,
  Tool,
  ToolCall,
  ToolResultMessage,
  TSchema,
  Usage
} from "@earendil-works/pi-ai";

import type { Model } from "@earendil-works/pi-ai";

export {
  createAssistantMessageEventStream,
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
}): Model<"openai-completions"> {
  return {
    id: options.id,
    name: options.name ?? options.id,
    api: "openai-completions",
    provider: options.provider ?? "openai",
    baseUrl: options.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096
  };
}
