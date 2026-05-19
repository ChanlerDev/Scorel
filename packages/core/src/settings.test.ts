import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  buildSystemPrompt,
  discoverOpenAICompatibleModels,
  loadScorelConfig,
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

describe("Scorel config", () => {
  it("merges global TOML, project TOML, and CLI overrides in precedence order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-config-"));
    try {
      const globalPath = join(dir, "global.toml");
      const projectDir = join(dir, "project");
      const projectPath = join(projectDir, ".scorel", "config.toml");
      await mkdir(join(projectDir, ".scorel"), { recursive: true });
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
        overrides: {
          model: { providerId: "amp", modelId: "project-model" }
        }
      });

      expect(config.model).toEqual({
        providerId: "amp",
        modelId: "project-model"
      });
      expect(config.providers.amp).toMatchObject({
        protocol: "openai-completions",
        baseUrl: "https://amp.chanler.dev/v1",
        apiKey: "project-key"
      });
      expect(config.session.dir).toBe(join(dir, "global-sessions"));
      expect(config.tools.preset).toBe("coding");
      expect(config.agent.systemPrompt).toBe("Project prompt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses MCP server config from TOML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-config-mcp-"));
    try {
      const configPath = join(dir, "config.toml");
      await writeFile(
        configPath,
        `
[mcp.servers.echo]
transport = "stdio"
startup = "required"
command = "node"
args = ["server.mjs"]
cwd = "/tmp"

[mcp.servers.echo.env]
TOKEN = "secret"

[mcp.servers.remote]
transport = "sse"
startup = "optional"
url = "https://mcp.example.invalid/sse"
`,
        "utf8"
      );

      const config = await loadScorelConfig({
        globalConfigPath: join(dir, "missing-global.toml"),
        projectConfigPath: configPath
      });

      expect(config.mcp.servers.echo).toEqual({
        transport: "stdio",
        startup: "required",
        command: "node",
        args: ["server.mjs"],
        cwd: "/tmp",
        env: { TOKEN: "secret" }
      });
      expect(config.mcp.servers.remote).toEqual({
        transport: "sse",
        startup: "optional",
        url: "https://mcp.example.invalid/sse"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not read legacy settings JSON or Scorel env overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-config-no-legacy-"));
    try {
      const projectPath = join(dir, "config.toml");
      await writeFile(
        join(dir, "settings.json"),
        JSON.stringify({
          model: { provider: "amp", id: "legacy-model", baseUrl: "https://legacy.invalid", apiKey: "legacy-key" },
          sessionsDir: join(dir, "legacy-sessions")
        }),
        "utf8"
      );
      await writeFile(
        projectPath,
        `
[providers.amp]
protocol = "openai-completions"
baseUrl = "https://amp.chanler.dev/v1"
apiKey = "toml-key"

[models.default]
providerId = "amp"
modelId = "toml-model"

[[models.available]]
providerId = "amp"
modelId = "toml-model"
`,
        "utf8"
      );

      const previousEnv = {
        SCOREL_PROVIDER: process.env.SCOREL_PROVIDER,
        SCOREL_MODEL: process.env.SCOREL_MODEL,
        SCOREL_BASE_URL: process.env.SCOREL_BASE_URL,
        SCOREL_API_KEY: process.env.SCOREL_API_KEY
      };
      process.env.SCOREL_PROVIDER = "env-provider";
      process.env.SCOREL_MODEL = "env-model";
      process.env.SCOREL_BASE_URL = "https://env.invalid";
      process.env.SCOREL_API_KEY = "env-key";
      let config;
      try {
        config = await loadScorelConfig({
          cwd: dir,
          globalConfigPath: join(dir, "missing-global.toml"),
          projectConfigPath: projectPath
        });
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }

      expect(config.model).toEqual({ providerId: "amp", modelId: "toml-model" });
      expect(config.providers.amp.apiKey).toBe("toml-key");
      expect(config.session.dir).not.toBe(join(dir, "legacy-sessions"));
      expect(config.providers).not.toHaveProperty("env-provider");
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
        globalConfigPath: join(dir, "missing-global.toml"),
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

  it("discovers OpenAI-compatible model ids as candidates for available model selection", async () => {
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
