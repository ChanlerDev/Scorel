import { describe, expect, it } from "vitest";
import {
  PROVIDER_PRESETS,
  buildProviderConfig,
  getProviderPreset,
  validateProviderDraft,
} from "../../src/renderer/components/setup-wizard-model.js";

describe("setup-wizard-model", () => {
  it("exposes the built-in provider presets", () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      "openai",
      "anthropic",
      "custom",
    ]);
    expect(getProviderPreset("anthropic")?.auth.type).toBe("x-api-key");
  });

  it("builds a provider config from wizard input", () => {
    const config = buildProviderConfig({
      providerType: "custom",
      displayName: "My Test Provider",
      baseUrl: "https://example.com/v1/",
      modelId: "gpt-test",
    });

    expect(config).toMatchObject({
      id: "my-test-provider",
      displayName: "My Test Provider",
      api: "openai-chat-completions",
      baseUrl: "https://example.com/v1",
      auth: {
        type: "bearer",
        keyRef: "my-test-provider",
      },
      models: [{ id: "gpt-test", displayName: "gpt-test" }],
    });
  });

  it("builds configs for the built-in hosted provider presets", () => {
    const openaiConfig = buildProviderConfig({
      providerType: "openai",
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1/",
      modelId: "gpt-4o",
    });
    const anthropicConfig = buildProviderConfig({
      providerType: "anthropic",
      displayName: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1/",
      modelId: "claude-sonnet-4-20250514",
    });

    expect(openaiConfig).toMatchObject({
      api: "openai-chat-completions",
      baseUrl: "https://api.openai.com/v1",
      auth: { type: "bearer", keyRef: "openai" },
    });
    expect(anthropicConfig).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1",
      auth: { type: "x-api-key", keyRef: "anthropic" },
    });
  });

  it("validates required wizard fields before testing the connection", () => {
    expect(validateProviderDraft({
      displayName: "",
      baseUrl: "",
      modelId: "",
      apiKey: "",
    })).toEqual([
      "Display name is required",
      "Base URL is required",
      "Model is required",
      "API key is required",
    ]);
  });

  it("treats whitespace-only input as missing", () => {
    expect(validateProviderDraft({
      displayName: "  ",
      baseUrl: "  ",
      modelId: "  ",
      apiKey: "  ",
    })).toEqual([
      "Display name is required",
      "Base URL is required",
      "Model is required",
      "API key is required",
    ]);
  });
});
