import { asClientId, asEventId, asSeq, asSessionId, type ScorelEvent } from "@scorel/protocol";
import { describe, expect, it } from "vitest";

import { buildRunObservation } from "./index.js";

describe("reporting", () => {
  it("aggregates assistant usage and estimates known model cost", () => {
    const observation = buildRunObservation({
      events: [
        assistantEvent({
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          provider: "openai",
          api: "openai-completions",
          model: "gpt-4o-mini",
        }),
        assistantEvent({
          inputTokens: 200,
          outputTokens: 300,
          totalTokens: 500,
          provider: "openai",
          api: "openai-completions",
          model: "gpt-4o-mini",
        }),
      ],
      selectedModel: {
        modelId: "main",
        providerModelId: "gpt-4o-mini",
        provider: "openai",
        api: "openai-completions",
        displayName: "GPT 4o Mini",
      },
    });

    expect(observation.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 800,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2000,
    });
    expect(observation.model).toMatchObject({
      modelId: "main",
      providerModelId: "gpt-4o-mini",
      provider: "openai",
      api: "openai-completions",
      displayName: "GPT 4o Mini",
    });
    expect(observation.cost).toMatchObject({
      known: true,
      currency: "USD",
      pricingSource: "official-provider-pricing-2026-08-07",
      pricingModelId: "gpt-4o-mini",
    });
    expect(observation.cost.input).toBeGreaterThan(0);
    expect(observation.cost.output).toBeGreaterThan(0);
    expect(observation.cost.total).toBeCloseTo(observation.cost.input + observation.cost.output, 12);
  });

  it("marks unknown model pricing without inventing a cost", () => {
    const observation = buildRunObservation({
      events: [
        assistantEvent({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          provider: "custom",
          api: "openai-completions",
          model: "local-private-model",
        }),
      ],
      selectedModel: {
        modelId: "local-private-model",
        providerModelId: "local-private-model",
        provider: "custom",
        api: "openai-completions",
      },
    });

    expect(observation.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
    });
    expect(observation.cost).toEqual({
      known: false,
      currency: "USD",
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      pricingSource: "official-provider-pricing-2026-08-07",
      reason: "unknown_model_price",
    });
  });

  it("estimates current official model ids from the local models.dev snapshot", () => {
    const observation = buildRunObservation({
      events: [
        assistantEvent({
          inputTokens: 1000,
          outputTokens: 1000,
          totalTokens: 2000,
          provider: "custom",
          api: "openai-completions",
          model: "gpt-5.4-mini",
        }),
      ],
      selectedModel: {
        modelId: "gpt-5.4-mini",
        providerModelId: "gpt-5.4-mini",
        provider: "custom",
        api: "openai-completions",
      },
    });

    expect(observation.cost).toMatchObject({
      known: true,
      pricingModelId: "gpt-5.4-mini",
    });
    expect(observation.cost.input).toBeCloseTo(0.00075, 12);
    expect(observation.cost.output).toBeCloseTo(0.0045, 12);
    expect(observation.cost.total).toBeCloseTo(0.00525, 12);
  });

  it("aggregates and prices cache read and write tokens separately", () => {
    const event = assistantEvent({
      inputTokens: 1_000,
      outputTokens: 500,
      totalTokens: 0,
      provider: "openai",
      api: "openai-completions",
      model: "gpt-4o-mini",
    });
    if (event.type === "assistant_message" && event.message.usage) {
      event.message.usage.cacheReadTokens = 2_000;
      event.message.usage.cacheWriteTokens = 300;
    }

    const observation = buildRunObservation({ events: [event], selectedModel: { modelId: "gpt-4o-mini" } });

    expect(observation.usage).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 300,
      totalTokens: 3_800,
    });
    expect(observation.cost.input).toBeCloseTo(0.00015, 12);
    expect(observation.cost.output).toBeCloseTo(0.0003, 12);
    expect(observation.cost.cacheRead).toBeCloseTo(0.00015, 12);
    expect(observation.cost.cacheWrite).toBe(0);
    expect(observation.cost.total).toBeCloseTo(0.0006, 12);
  });

  it("uses reduced GPT-5.6 pricing and its per-request long-context tier", () => {
    const short = assistantEvent({
      inputTokens: 100_000,
      outputTokens: 10_000,
      totalTokens: 110_000,
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.6-luna",
    });
    const long = assistantEvent({
      inputTokens: 100_000,
      outputTokens: 10_000,
      totalTokens: 310_000,
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.6-luna",
    });
    if (long.type === "assistant_message" && long.message.usage) {
      long.message.usage.cacheReadTokens = 200_000;
    }

    const observation = buildRunObservation({ events: [short, long] });

    expect(observation.cost.input).toBeCloseTo(0.06, 12);
    expect(observation.cost.output).toBeCloseTo(0.03, 12);
    expect(observation.cost.cacheRead).toBeCloseTo(0.008, 12);
    expect(observation.cost.total).toBeCloseTo(0.098, 12);
  });

  it("prices Anthropic cache writes at the published premium", () => {
    const event = assistantEvent({
      inputTokens: 1_000,
      outputTokens: 500,
      totalTokens: 3_500,
      provider: "anthropic",
      api: "anthropic-messages",
      model: "claude-sonnet-4-5",
    });
    if (event.type === "assistant_message" && event.message.usage) {
      event.message.usage.cacheReadTokens = 1_000;
      event.message.usage.cacheWriteTokens = 1_000;
    }

    const observation = buildRunObservation({ events: [event] });

    expect(observation.cost.input).toBeCloseTo(0.003, 12);
    expect(observation.cost.output).toBeCloseTo(0.0075, 12);
    expect(observation.cost.cacheRead).toBeCloseTo(0.0003, 12);
    expect(observation.cost.cacheWrite).toBeCloseTo(0.00375, 12);
    expect(observation.cost.total).toBeCloseTo(0.01455, 12);
  });

  it("uses current Claude 5 pricing", () => {
    const event = assistantEvent({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
      provider: "anthropic",
      api: "anthropic-messages",
      model: "claude-opus-5",
    });

    const observation = buildRunObservation({ events: [event] });

    expect(observation.cost.input).toBe(5);
    expect(observation.cost.output).toBe(25);
    expect(observation.cost.total).toBe(30);
  });

  it("uses explicit DeepSeek cache-read pricing instead of a family multiplier", () => {
    const event = assistantEvent({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 1_000_000,
      provider: "deepseek",
      api: "openai-completions",
      model: "deepseek-v4-flash",
    });
    if (event.type === "assistant_message" && event.message.usage) {
      event.message.usage.cacheReadTokens = 1_000_000;
    }

    const observation = buildRunObservation({ events: [event] });

    expect(observation.cost.cacheRead).toBeCloseTo(0.0028, 12);
    expect(observation.cost.total).toBeCloseTo(0.0028, 12);
  });

  it("matches price by model id without requiring a provider match", () => {
    const observation = buildRunObservation({
      events: [
        assistantEvent({
          inputTokens: 1000,
          outputTokens: 1000,
          totalTokens: 2000,
          provider: "custom",
          api: "messages",
          model: "claude-opus-4-8",
        }),
      ],
      selectedModel: {
        modelId: "claude-opus-4-8",
        providerModelId: "claude-opus-4-8",
        provider: "custom",
        api: "messages",
      },
    });

    expect(observation.cost).toMatchObject({
      known: true,
      pricingModelId: "claude-opus-4-8",
    });
    expect(observation.cost.input).toBeCloseTo(0.005, 12);
    expect(observation.cost.output).toBeCloseTo(0.025, 12);
    expect(observation.cost.total).toBeCloseTo(0.03, 12);
  });

  it("does not treat non-official or malformed common-looking ids as priced", () => {
    const observation = buildRunObservation({
      events: [
        assistantEvent({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          provider: "anthropic",
          api: "messages",
          model: "claude-opus-4.8",
        }),
      ],
      selectedModel: {
        modelId: "claude-opus-4.8",
        providerModelId: "claude-opus-4.8",
        provider: "anthropic",
        api: "messages",
      },
    });

    expect(observation.cost).toMatchObject({
      known: false,
      reason: "unknown_model_price",
    });
  });
});

const assistantEvent = (input: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider: string;
  api: string;
  model: string;
}): ScorelEvent => ({
  type: "assistant_message",
  id: asEventId(`evt_${input.model}_${input.inputTokens}`),
  parentId: null,
  sessionId: asSessionId("ses_reporting"),
  clientId: asClientId("client_reporting"),
  seq: asSeq(input.inputTokens),
  ts: 1,
  message: {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    stopReason: "end_turn",
    usage: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
    },
    meta: {
      provider: input.provider,
      api: input.api,
      model: input.model,
    },
  },
});
