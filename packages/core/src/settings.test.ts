import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { loadScorelSettings, resolveScorelModel } from "./settings.js";
import type { Api, Model } from "./llm.js";

function testModel(id = "known-model"): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-responses" as const,
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096
  };
}

describe("Scorel settings", () => {
  it("returns defaults when the settings file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-settings-"));
    try {
      await expect(loadScorelSettings(join(dir, "missing.json"))).resolves.toMatchObject({
        model: {
          provider: "openai",
          id: "gpt-4o-mini"
        },
        sessionsDir: expect.stringContaining(".scorel")
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear error when settings JSON is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-settings-"));
    try {
      const path = join(dir, "settings.json");
      await writeFile(path, "{bad json", "utf8");

      await expect(loadScorelSettings(path)).rejects.toThrow(`Invalid Scorel settings JSON at ${path}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves env model values before settings values", async () => {
    const getModel = vi.fn(() => testModel("env-model"));
    const createOpenAICompatibleChatModel = vi.fn(() => testModel("custom"));

    const result = resolveScorelModel(
      {
        env: {
          SCOREL_PROVIDER: "openai",
          SCOREL_MODEL: "env-model"
        },
        settings: {
          model: {
            provider: "anthropic",
            id: "settings-model"
          }
        }
      },
      { getModel, createOpenAICompatibleChatModel }
    );

    expect(result.model.id).toBe("env-model");
    expect(result.apiKey).toBeUndefined();
    expect(getModel).toHaveBeenCalledWith("openai", "env-model");
    expect(createOpenAICompatibleChatModel).not.toHaveBeenCalled();
  });

  it("uses OpenAI-compatible helper only when a custom base URL is configured", async () => {
    const getModel = vi.fn(() => testModel("known"));
    const createOpenAICompatibleChatModel = vi.fn(() => testModel("custom"));

    const result = resolveScorelModel(
      {
        env: {},
        settings: {
          model: {
            provider: "amp",
            id: "gpt-5.4-mini",
            baseUrl: "https://amp.chanler.dev/v1",
            apiKey: "from-settings"
          }
        }
      },
      { getModel, createOpenAICompatibleChatModel }
    );

    expect(result.model.id).toBe("custom");
    expect(result.apiKey).toBe("from-settings");
    expect(createOpenAICompatibleChatModel).toHaveBeenCalledWith({
      provider: "amp",
      id: "gpt-5.4-mini",
      baseUrl: "https://amp.chanler.dev/v1"
    });
    expect(getModel).not.toHaveBeenCalled();
  });

  it("uses settings API key before generic provider environment keys", async () => {
    const result = resolveScorelModel(
      {
        env: {
          OPENAI_API_KEY: "generic-env-key"
        },
        settings: {
          model: {
            baseUrl: "https://amp.chanler.dev/v1",
            apiKey: "settings-key"
          }
        }
      },
      { createOpenAICompatibleChatModel: vi.fn(() => testModel("custom")) }
    );

    expect(result.apiKey).toBe("settings-key");
  });
});
