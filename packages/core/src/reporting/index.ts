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
  cacheRead: number;
  cacheWrite: number;
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
  cacheReadUsdPerMillionTokens: number;
  cacheWriteUsdPerMillionTokens: number;
  pricingModelId: string;
  longContext?: Omit<RunPrice, "pricingModelId" | "longContext"> & { inputTokensAbove: number };
};

export const SCOREL_PRICING_SOURCE = "official-provider-pricing-2026-08-07" as const;

const MODEL_PRICES: Record<string, RunPrice> = {
  ...modelPrices({
    "gpt-4o-mini": [0.15, 0.6],
    "gpt-4o": [2.5, 10],
  }, { cacheReadMultiplier: 0.5, cacheWriteMultiplier: 0 }),
  ...modelPrices({
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
  }, { cacheReadMultiplier: 0.1, cacheWriteMultiplier: 0 }),
  "gpt-5.6-sol": tieredPrice("gpt-5.6-sol", [5, 30, 0.5, 6.25], [10, 45, 1, 12.5]),
  "gpt-5.6-terra": tieredPrice("gpt-5.6-terra", [2, 12, 0.2, 2.5], [4, 18, 0.4, 5]),
  "gpt-5.6-luna": tieredPrice("gpt-5.6-luna", [0.2, 1.2, 0.02, 0.25], [0.4, 1.8, 0.04, 0.5]),
  ...modelPrices({
    "claude-fable-5": [10, 50],
    "claude-opus-5": [5, 25],
    "claude-sonnet-5": [2, 10],
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
  }, { cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 }),
  ...modelPrices({
    "deepseek-v4-flash": [0.14, 0.28],
    "deepseek-v4-pro": [0.435, 0.87],
  }, {
    cacheReadPrices: { "deepseek-v4-flash": 0.0028, "deepseek-v4-pro": 0.003625 },
    cacheWriteMultiplier: 0,
  }),
  ...modelPrices({
    "gemini-3-pro-preview": [2, 12],
    "gemini-3-flash-preview": [0.5, 3],
    "gemini-3.1-pro-preview": [2, 12],
    "gemini-3.1-pro-preview-customtools": [2, 12],
    "gemini-3.1-flash-lite": [0.25, 1.5],
    "gemini-3.1-flash-lite-preview": [0.25, 1.5],
    "gemini-3.5-flash": [1.5, 9],
  }, { cacheReadMultiplier: 0.1, cacheWriteMultiplier: 0 }),
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
  }, {
    cacheReadPrices: {
      "glm-4.5": 0.11,
      "glm-4.5-air": 0.03,
      "glm-4.5-flash": 0,
      "glm-4.5v": 0,
      "glm-4.6": 0.11,
      "glm-4.6v": 0,
      "glm-4.7": 0.11,
      "glm-4.7-flash": 0,
      "glm-4.7-flashx": 0.01,
      "glm-5": 0.2,
      "glm-5.1": 0.26,
      "glm-5.2": 0.26,
      "glm-5-turbo": 0.24,
      "glm-5v-turbo": 0.24,
    },
    cacheWriteMultiplier: 0,
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
    cost: estimateEventCost(input.events, usage, model),
  };
};

export const buildRunObservation = buildObservation;

export const aggregateUsage = (events: ScorelEvent[]): Required<Usage> => {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
  for (const event of events) {
    const messageUsage = event.type === "assistant_message" ? event.message.usage : event.type === "message_end" ? event.usage : undefined;
    if (!messageUsage) {
      continue;
    }
    usage.inputTokens += nonNegativeInteger(messageUsage.inputTokens);
    usage.outputTokens += nonNegativeInteger(messageUsage.outputTokens);
    usage.cacheReadTokens += nonNegativeInteger(messageUsage.cacheReadTokens);
    usage.cacheWriteTokens += nonNegativeInteger(messageUsage.cacheWriteTokens);
    usage.totalTokens += nonNegativeInteger(messageUsage.totalTokens);
  }
  if (usage.totalTokens === 0 && Object.values(usage).some((value) => value > 0)) {
    usage.totalTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens;
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
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      pricingSource: SCOREL_PRICING_SOURCE,
      reason: "unknown_model_price",
    };
  }
  return costForUsage(usage, price);
};

const estimateEventCost = (
  events: ScorelEvent[],
  aggregate: Required<Usage>,
  model: RunReportingModel | undefined,
): RunCostEstimate => {
  const price = modelPrice(model);
  if (!price) {
    return estimateRunCost(aggregate, model);
  }
  const usages = events.flatMap((event): Required<Usage>[] => {
    const usage = event.type === "assistant_message" ? event.message.usage : event.type === "message_end" ? event.usage : undefined;
    return usage ? [requiredUsage(usage)] : [];
  });
  if (usages.length === 0) {
    return costForUsage(aggregate, price);
  }
  const costs = usages.map((usage) => costForUsage(usage, price));
  return {
    known: true,
    currency: "USD",
    input: costs.reduce((sum, cost) => sum + cost.input, 0),
    output: costs.reduce((sum, cost) => sum + cost.output, 0),
    cacheRead: costs.reduce((sum, cost) => sum + cost.cacheRead, 0),
    cacheWrite: costs.reduce((sum, cost) => sum + cost.cacheWrite, 0),
    total: costs.reduce((sum, cost) => sum + cost.total, 0),
    pricingSource: SCOREL_PRICING_SOURCE,
    pricingModelId: price.pricingModelId,
  };
};

const costForUsage = (usage: Required<Usage>, basePrice: RunPrice): RunCostEstimate => {
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const price = basePrice.longContext && promptTokens > basePrice.longContext.inputTokensAbove
    ? { ...basePrice, ...basePrice.longContext }
    : basePrice;
  const input = (usage.inputTokens / 1_000_000) * price.inputUsdPerMillionTokens;
  const output = (usage.outputTokens / 1_000_000) * price.outputUsdPerMillionTokens;
  const cacheRead = (usage.cacheReadTokens / 1_000_000) * price.cacheReadUsdPerMillionTokens;
  const cacheWrite = (usage.cacheWriteTokens / 1_000_000) * price.cacheWriteUsdPerMillionTokens;
  return {
    known: true,
    currency: "USD",
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    pricingSource: SCOREL_PRICING_SOURCE,
    pricingModelId: price.pricingModelId,
  };
};

const requiredUsage = (usage: Usage): Required<Usage> => ({
  inputTokens: nonNegativeInteger(usage.inputTokens),
  outputTokens: nonNegativeInteger(usage.outputTokens),
  cacheReadTokens: nonNegativeInteger(usage.cacheReadTokens),
  cacheWriteTokens: nonNegativeInteger(usage.cacheWriteTokens),
  totalTokens: nonNegativeInteger(usage.totalTokens),
});

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

function modelPrices(
  prices: Record<string, [number, number]>,
  cache: {
    cacheReadMultiplier?: number;
    cacheReadPrices?: Record<string, number>;
    cacheWriteMultiplier: number;
  },
): Record<string, RunPrice> {
  const entries: Record<string, RunPrice> = {};
  for (const [modelId, [inputUsdPerMillionTokens, outputUsdPerMillionTokens]] of Object.entries(prices)) {
    entries[modelId] = {
      inputUsdPerMillionTokens,
      outputUsdPerMillionTokens,
      cacheReadUsdPerMillionTokens: cache.cacheReadPrices?.[modelId]
        ?? inputUsdPerMillionTokens * (cache.cacheReadMultiplier ?? 0),
      cacheWriteUsdPerMillionTokens: inputUsdPerMillionTokens * cache.cacheWriteMultiplier,
      pricingModelId: modelId,
    };
  }
  return entries;
}

function tieredPrice(
  modelId: string,
  standard: [number, number, number, number],
  longContext: [number, number, number, number],
): RunPrice {
  const [inputUsdPerMillionTokens, outputUsdPerMillionTokens, cacheReadUsdPerMillionTokens, cacheWriteUsdPerMillionTokens] = standard;
  const [longInput, longOutput, longCacheRead, longCacheWrite] = longContext;
  return {
    inputUsdPerMillionTokens,
    outputUsdPerMillionTokens,
    cacheReadUsdPerMillionTokens,
    cacheWriteUsdPerMillionTokens,
    pricingModelId: modelId,
    longContext: {
      inputTokensAbove: 272_000,
      inputUsdPerMillionTokens: longInput,
      outputUsdPerMillionTokens: longOutput,
      cacheReadUsdPerMillionTokens: longCacheRead,
      cacheWriteUsdPerMillionTokens: longCacheWrite,
    },
  };
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
