import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  buildSystemPrompt,
  discoverOpenAICompatibleModels,
  loadScorelConfig,
  loadScorelSettings,
  resolveScorelModel,
  selectScorelTools
} from "./settings.js";
import type { ScorelConfigInput } from "./settings.js";
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

  it("does not pass OPENAI_API_KEY as a generic key for non-OpenAI known providers", async () => {
    const result = resolveScorelModel(
      {
        env: {
          OPENAI_API_KEY: "openai-key"
        },
        settings: {
          model: {
            provider: "anthropic",
            id: "claude-test"
          }
        }
      },
      { getModel: vi.fn(() => testModel("known")) }
    );

    expect(result.apiKey).toBeUndefined();
  });
});

describe("Scorel config", () => {
  it("merges legacy settings, global TOML, project TOML, env, and CLI overrides in precedence order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-config-"));
    try {
      const legacyPath = join(dir, "settings.json");
      const globalPath = join(dir, "global.toml");
      const projectDir = join(dir, "project");
      const projectPath = join(projectDir, ".scorel", "config.toml");
      await mkdir(join(projectDir, ".scorel"), { recursive: true });
      await writeFile(
        legacyPath,
        JSON.stringify({
          model: { provider: "legacy", id: "legacy-model", baseUrl: "https://legacy.invalid", apiKey: "legacy-key" },
          sessionsDir: join(dir, "legacy-sessions")
        }),
        "utf8"
      );
      await writeFile(
        globalPath,
        `
[models.default]
providerId = "global"
modelId = "global-model"

[session]
dir = "${join(dir, "global-sessions")}"

[tools]
preset = "readonly"
`,
        "utf8"
      );
      await writeFile(
        projectPath,
        `
[providers.amp]
protocol = "openai-completions"
baseUrl = "https://amp.chanler.dev/v1"
apiKey = "project-key"

[models.default]
providerId = "amp"
modelId = "project-model"

[[models.available]]
providerId = "amp"
modelId = "project-model"

[agent]
systemPrompt = "Project prompt"

[tools]
preset = "coding"
`,
        "utf8"
      );

      const config = await loadScorelConfig({
        cwd: projectDir,
        globalConfigPath: globalPath,
        projectConfigPath: projectPath,
        legacySettingsPath: legacyPath,
        env: {
          SCOREL_MODEL: "env-model",
          SCOREL_API_KEY: "env-key"
        },
        overrides: {
          model: { providerId: "amp" }
        }
      });

      expect(config.model).toEqual({
        providerId: "amp",
        modelId: "env-model"
      });
      expect(config.providers.amp).toMatchObject({
        protocol: "openai-completions",
        baseUrl: "https://amp.chanler.dev/v1",
        apiKey: "env-key"
      });
      expect(config.session.dir).toBe(join(dir, "global-sessions"));
      expect(config.tools.preset).toBe("coding");
      expect(config.agent.systemPrompt).toBe("Project prompt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects custom providers that shadow built-in providers", async () => {
    const config: ScorelConfigInput = {
      providers: {
        openai: {
          protocol: "openai-completions",
          baseUrl: "https://shadow.invalid"
        }
      },
      models: {
        default: { providerId: "openai", modelId: "gpt-4o-mini" },
        available: [{ providerId: "openai", modelId: "gpt-4o-mini" }]
      }
    };

    expect(() => resolveScorelModel({ config }, { getProviders: () => ["openai"] })).toThrow(
      "Custom provider openai shadows a built-in provider"
    );
  });

  it("requires model selection to be in the available provider/model set", async () => {
    expect(() => resolveScorelModel({
      config: {
        models: {
          default: { providerId: "openai", modelId: "not-allowed" },
          available: [{ providerId: "openai", modelId: "allowed" }]
        }
      }
    }, { getProviders: () => ["openai"] })).toThrow("Model openai/not-allowed is not in models.available");
  });

  it("ignores empty CLI model overrides instead of shadowing configured defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-config-empty-override-"));
    try {
      const projectPath = join(dir, "config.toml");
      await writeFile(
        projectPath,
        `
[providers.amp]
protocol = "openai-completions"
baseUrl = "https://amp.chanler.dev/v1"

[models.default]
providerId = "amp"
modelId = "gpt-5.4-mini"

[[models.available]]
providerId = "amp"
modelId = "gpt-5.4-mini"
`,
        "utf8"
      );

      const config = await loadScorelConfig({
        projectConfigPath: projectPath,
        legacySettingsPath: join(dir, "missing-settings.json"),
        globalConfigPath: join(dir, "missing-global.toml"),
        env: {},
        overrides: { model: { providerId: undefined, modelId: undefined } }
      });

      expect(config.model).toEqual({ providerId: "amp", modelId: "gpt-5.4-mini" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps equal model ids under different providers distinct", async () => {
    const getModel = vi.fn((provider: string, modelId: string) => testModel(`${provider}/${modelId}`));

    const result = resolveScorelModel({
      config: {
        models: {
          default: { providerId: "anthropic", modelId: "same-id" },
          available: [
            { providerId: "openai", modelId: "same-id" },
            { providerId: "anthropic", modelId: "same-id" }
          ]
        }
      }
    }, { getProviders: () => ["openai", "anthropic"], getModel });

    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toBe("same-id");
    expect(result.model.id).toBe("anthropic/same-id");
  });

  it("resolves a custom OpenAI-compatible model with configured metadata", async () => {
    const createOpenAICompatibleChatModel = vi.fn(() => testModel("custom"));

    const result = resolveScorelModel({
      config: {
        providers: {
          amp: {
            protocol: "openai-completions",
            baseUrl: "https://amp.chanler.dev/v1",
            apiKey: "amp-key",
            models: {
              "gpt-5.4-mini": {
                name: "GPT 5.4 Mini",
                contextWindow: 256000,
                maxTokens: 8192,
                input: ["text"],
                reasoning: true,
                cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 }
              }
            }
          }
        },
        models: {
          default: { providerId: "amp", modelId: "gpt-5.4-mini" },
          available: [{ providerId: "amp", modelId: "gpt-5.4-mini" }]
        }
      }
    }, { getProviders: () => ["openai"], createOpenAICompatibleChatModel });

    expect(result.apiKey).toBe("amp-key");
    expect(createOpenAICompatibleChatModel).toHaveBeenCalledWith({
      provider: "amp",
      id: "gpt-5.4-mini",
      baseUrl: "https://amp.chanler.dev/v1",
      name: "GPT 5.4 Mini",
      metadata: expect.objectContaining({ contextWindow: 256000, maxTokens: 8192 })
    });
  });

  it("discovers OpenAI-compatible model ids without adding them to available models", async () => {
    const discovered = await discoverOpenAICompatibleModels({
      baseUrl: "https://amp.chanler.dev/v1",
      apiKey: "test",
      fetch: async (url, init) => {
        expect(url).toBe("https://amp.chanler.dev/v1/models");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer test" });
        return new Response(JSON.stringify({ data: [{ id: "gpt-5.4-mini" }, { id: "other" }] }));
      }
    });

    expect(discovered).toEqual(["gpt-5.4-mini", "other"]);
  });

  it("builds a system prompt from base prompt, cwd, date, and project instructions", async () => {
    const prompt = await buildSystemPrompt({
      config: {
        agent: {
          systemPrompt: "You are Scorel.",
          instructions: "Project rules."
        }
      },
      cwd: "/repo",
      now: new Date("2026-05-19T00:00:00.000Z")
    });

    expect(prompt).toContain("You are Scorel.");
    expect(prompt).toContain("cwd: /repo");
    expect(prompt).toContain("date: 2026-05-19");
    expect(prompt).toContain("Project rules.");
  });

  it("selects tool presets", () => {
    const readonly = [{ name: "read" }, { name: "grep" }] as never;
    const write = [{ name: "bash" }, { name: "write" }] as never;

    expect(selectScorelTools("none", { readonlyTools: readonly, writeTools: write })).toEqual([]);
    expect(selectScorelTools("readonly", { readonlyTools: readonly, writeTools: write }).map((tool) => tool.name)).toEqual([
      "read",
      "grep"
    ]);
    expect(selectScorelTools("coding", { readonlyTools: readonly, writeTools: write }).map((tool) => tool.name)).toEqual([
      "read",
      "grep",
      "bash",
      "write"
    ]);
    expect(selectScorelTools("all", { readonlyTools: readonly, writeTools: write }).map((tool) => tool.name)).toEqual([
      "read",
      "grep",
      "bash",
      "write"
    ]);
  });
});
