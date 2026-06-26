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

    expect(observation.usage).toEqual({ inputTokens: 1200, outputTokens: 800, totalTokens: 2000 });
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
      pricingSource: "models.dev-api-2026-06-27",
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

    expect(observation.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    expect(observation.cost).toEqual({
      known: false,
      currency: "USD",
      input: 0,
      output: 0,
      total: 0,
      pricingSource: "models.dev-api-2026-06-27",
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
          provider: "chanleramp",
          api: "openai-completions",
          model: "gpt-5.4-mini",
        }),
      ],
      selectedModel: {
        modelId: "gpt-5.4-mini",
        providerModelId: "gpt-5.4-mini",
        provider: "chanleramp",
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

  it("matches price by model id without requiring a provider match", () => {
    const observation = buildRunObservation({
      events: [
        assistantEvent({
          inputTokens: 1000,
          outputTokens: 1000,
          totalTokens: 2000,
          provider: "chanleramp",
          api: "messages",
          model: "claude-opus-4-8",
        }),
      ],
      selectedModel: {
        modelId: "claude-opus-4-8",
        providerModelId: "claude-opus-4-8",
        provider: "chanleramp",
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
