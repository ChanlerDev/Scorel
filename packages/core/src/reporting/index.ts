import type { ReasoningEffort, ScorelEvent, Usage } from "@scorel/protocol";

export type RunReportingModel = {
  modelId?: string;
  providerModelId?: string;
  provider?: string;
  api?: string;
  displayName?: string;
  reasoningEffort?: ReasoningEffort;
};

export type RunCostEstimate = {
  known: boolean;
  currency: "USD";
  input: number;
  output: number;
  total: number;
  pricingSource: typeof SCOREL_PRICING_SOURCE;
  pricingModelId?: string;
  reason?: "unknown_model_price";
};

export type RunObservation = {
  usage: Required<Usage>;
  model?: RunReportingModel;
  cost: RunCostEstimate;
};

export type RunPrice = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  pricingModelId: string;
};

export const SCOREL_PRICING_SOURCE = "models.dev-api-2026-06-27" as const;

const MODEL_PRICES: Record<string, RunPrice> = {
  ...modelPrices({
    "gpt-4o-mini": [0.15, 0.6],
    "gpt-4o": [2.5, 10],
    "gpt-5": [1.25, 10],
    "gpt-5-chat-latest": [1.25, 10],
    "gpt-5-codex": [1.25, 10],
    "gpt-5-mini": [0.25, 2],
    "gpt-5-nano": [0.05, 0.4],
    "gpt-5-pro": [15, 120],
    "gpt-5.1": [1.25, 10],
    "gpt-5.1-chat-latest": [1.25, 10],
    "gpt-5.1-codex": [1.25, 10],
    "gpt-5.1-codex-max": [1.25, 10],
    "gpt-5.1-codex-mini": [0.25, 2],
    "gpt-5.2": [1.75, 14],
    "gpt-5.2-chat-latest": [1.75, 14],
    "gpt-5.2-codex": [1.75, 14],
    "gpt-5.2-pro": [21, 168],
    "gpt-5.3-chat-latest": [1.75, 14],
    "gpt-5.3-codex": [1.75, 14],
    "gpt-5.3-codex-spark": [1.75, 14],
    "gpt-5.4": [2.5, 15],
    "gpt-5.4-mini": [0.75, 4.5],
    "gpt-5.4-nano": [0.2, 1.25],
    "gpt-5.4-pro": [30, 180],
    "gpt-5.5": [5, 30],
    "gpt-5.5-pro": [30, 180],
  }),
  ...modelPrices({
    "claude-haiku-4-5": [1, 5],
    "claude-haiku-4-5-20251001": [1, 5],
    "claude-sonnet-4-0": [3, 15],
    "claude-sonnet-4-20250514": [3, 15],
    "claude-sonnet-4-5": [3, 15],
    "claude-sonnet-4-5-20250929": [3, 15],
    "claude-sonnet-4-6": [3, 15],
    "claude-opus-4-0": [15, 75],
    "claude-opus-4-20250514": [15, 75],
    "claude-opus-4-1": [15, 75],
    "claude-opus-4-1-20250805": [15, 75],
    "claude-opus-4-5": [5, 25],
    "claude-opus-4-5-20251101": [5, 25],
    "claude-opus-4-6": [5, 25],
    "claude-opus-4-7": [5, 25],
    "claude-opus-4-8": [5, 25],
  }),
  ...modelPrices({
    "deepseek-v4-flash": [0.14, 0.28],
    "deepseek-v4-pro": [0.435, 0.87],
  }),
  ...modelPrices({
    "gemini-3-pro-preview": [2, 12],
    "gemini-3-flash-preview": [0.5, 3],
    "gemini-3.1-pro-preview": [2, 12],
    "gemini-3.1-pro-preview-customtools": [2, 12],
    "gemini-3.1-flash-lite": [0.25, 1.5],
    "gemini-3.1-flash-lite-preview": [0.25, 1.5],
    "gemini-3.5-flash": [1.5, 9],
  }),
  ...modelPrices({
    "glm-4.5": [0.6, 2.2],
    "glm-4.5-air": [0.2, 1.1],
    "glm-4.5-flash": [0, 0],
    "glm-4.5v": [0.6, 1.8],
    "glm-4.6": [0.6, 2.2],
    "glm-4.6v": [0.3, 0.9],
    "glm-4.7": [0.6, 2.2],
    "glm-4.7-flash": [0, 0],
    "glm-4.7-flashx": [0.07, 0.4],
    "glm-5": [1, 3.2],
    "glm-5.1": [1.4, 4.4],
    "glm-5.2": [1.4, 4.4],
    "glm-5-turbo": [1.2, 4],
    "glm-5v-turbo": [1.2, 4],
  }),
};

export const buildObservation = (input: {
  events: ScorelEvent[];
  selectedModel?: RunReportingModel;
}): RunObservation => {
  const usage = aggregateUsage(input.events);
  const model = mergeModel(input.selectedModel, modelFromEvents(input.events));
  return {
    usage,
    ...(model ? { model } : {}),
    cost: estimateRunCost(usage, model),
  };
};

export const buildRunObservation = buildObservation;

export const aggregateUsage = (events: ScorelEvent[]): Required<Usage> => {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const event of events) {
    const messageUsage = event.type === "assistant_message" ? event.message.usage : event.type === "message_end" ? event.usage : undefined;
    if (!messageUsage) {
      continue;
    }
    usage.inputTokens += nonNegativeInteger(messageUsage.inputTokens);
    usage.outputTokens += nonNegativeInteger(messageUsage.outputTokens);
    usage.totalTokens += nonNegativeInteger(messageUsage.totalTokens);
  }
  if (usage.totalTokens === 0 && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  }
  return usage;
};

export const estimateRunCost = (usage: Required<Usage>, model: RunReportingModel | undefined): RunCostEstimate => {
  const price = modelPrice(model);
  if (!price) {
    return {
      known: false,
      currency: "USD",
      input: 0,
      output: 0,
      total: 0,
      pricingSource: SCOREL_PRICING_SOURCE,
      reason: "unknown_model_price",
    };
  }
  const input = (usage.inputTokens / 1_000_000) * price.inputUsdPerMillionTokens;
  const output = (usage.outputTokens / 1_000_000) * price.outputUsdPerMillionTokens;
  return {
    known: true,
    currency: "USD",
    input,
    output,
    total: input + output,
    pricingSource: SCOREL_PRICING_SOURCE,
    pricingModelId: price.pricingModelId,
  };
};

const modelPrice = (model: RunReportingModel | undefined): RunPrice | undefined => {
  for (const id of [model?.providerModelId, model?.modelId]) {
    if (!id) {
      continue;
    }
    const price = MODEL_PRICES[id];
    if (price) {
      return price;
    }
  }
  return undefined;
};

function modelPrices(prices: Record<string, [number, number]>): Record<string, RunPrice> {
  const entries: Record<string, RunPrice> = {};
  for (const [modelId, [inputUsdPerMillionTokens, outputUsdPerMillionTokens]] of Object.entries(prices)) {
    entries[modelId] = { inputUsdPerMillionTokens, outputUsdPerMillionTokens, pricingModelId: modelId };
  }
  return entries;
}

const modelFromEvents = (events: ScorelEvent[]): RunReportingModel | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "assistant_message") {
      continue;
    }
    const meta = event.message.meta;
    const providerModelId = stringValue(meta?.model);
    const model = {
      ...(providerModelId ? { providerModelId } : {}),
      ...(stringValue(meta?.provider) ? { provider: stringValue(meta?.provider) } : {}),
      ...(stringValue(meta?.api) ? { api: stringValue(meta?.api) } : {}),
    };
    return Object.keys(model).length > 0 ? model : undefined;
  }
  return undefined;
};

const mergeModel = (selected: RunReportingModel | undefined, observed: RunReportingModel | undefined): RunReportingModel | undefined => {
  const merged = {
    ...observed,
    ...selected,
    providerModelId: selected?.providerModelId ?? observed?.providerModelId ?? selected?.modelId,
    provider: selected?.provider ?? observed?.provider,
    api: selected?.api ?? observed?.api,
  };
  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined;
};

const stringValue = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;

const nonNegativeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
};
