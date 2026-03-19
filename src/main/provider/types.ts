import type { ScorelMessage, ProviderConfig, AssistantMessage } from "../../shared/types.js";
import type { AssistantMessageEvent } from "../../shared/events.js";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ProviderRequestOptions = {
  systemPrompt: string;
  messages: ScorelMessage[];
  providerId: string;
  modelId: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ProviderAdapter = {
  readonly api: string;
  stream(
    config: ProviderConfig,
    apiKey: string,
    opts: ProviderRequestOptions,
    onEvent: (event: AssistantMessageEvent) => void,
  ): Promise<AssistantMessage>;
};
