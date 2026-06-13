import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCOREL_CONFIG_SCHEMA,
  loadScorelConfig,
  loadScorelConfigProfile,
  renderExtensionConfig,
  renderMemoryConfig,
  renderModelProfileConfig,
  renderRuntimeConfig,
  scorelProjectConfigPath,
  scorelSessionsDir,
  scorelUserConfigPath,
  scorelUserRoot,
} from "./index.js";

describe("loadScorelConfig", () => {
  it("keeps fixed product paths out of user config", () => {
    expect(scorelUserRoot("/home/alice")).toBe("/home/alice/.scorel");
    expect(scorelUserConfigPath("/home/alice")).toBe("/home/alice/.scorel/config.toml");
    expect(scorelSessionsDir("/home/alice")).toBe("/home/alice/.scorel/sessions");
    expect(scorelProjectConfigPath("/repo")).toBe("/repo/.scorel/config.toml");
    expect(SCOREL_CONFIG_SCHEMA.fixedPaths).toEqual({
      userRoot: "~/.scorel",
      userConfig: "~/.scorel/config.toml",
      sessionsDir: "~/.scorel/sessions",
      projectConfig: ".scorel/config.toml",
    });
  });

  it("loads a builtin provider model profile from project .scorel/config.toml", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[provider_models.openai_gpt_54_nano]
provider = "openai"
id = "gpt-5.4-nano"
displayName = "GPT 5.4 Nano"

[available_models.main]
model = "openai_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[available_models.aux]
model = "openai_gpt_54_nano"
displayName = "GPT 5.4 Nano"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "aux"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).resolves.toMatchObject({
      providers: {
        openai: {
          type: "builtin",
          provider: "openai",
          apiKey: "chanleramp",
        },
      },
      providerModels: {
        openai_gpt_54_mini: {
          provider: "openai",
          id: "gpt-5.4-mini",
          displayName: "GPT 5.4 Mini",
        },
        openai_gpt_54_nano: {
          provider: "openai",
          id: "gpt-5.4-nano",
          displayName: "GPT 5.4 Nano",
        },
      },
      models: {
        main: { model: "openai_gpt_54_mini", displayName: "GPT 5.4 Mini" },
        aux: { model: "openai_gpt_54_nano", displayName: "GPT 5.4 Nano" },
      },
      modelProfile: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "aux",
        },
      },
      memory: {
        enabled: true,
        daily: true,
        sessionMemory: true,
        autoDream: true,
        promoteRoot: true,
        dreamIdleMinutes: 60,
        autoCompactThreshold: 0.8,
      },
    });
  });

  it("loads and renders memory settings", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "openai_gpt_54_mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"

[memory]
enabled = true
daily = false
sessionMemory = true
autoDream = true
promoteRoot = false
dreamIdleMinutes = 15
autoCompactThreshold = 0.75
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "secret" } })).resolves.toMatchObject({
      memory: {
        enabled: true,
        daily: false,
        sessionMemory: true,
        autoDream: true,
        promoteRoot: false,
        dreamIdleMinutes: 15,
        autoCompactThreshold: 0.75,
      },
    });

    const rendered = renderMemoryConfig({
      existingConfigText: await readProjectConfig(cwd),
      daily: true,
      sessionMemory: false,
      promoteRoot: true,
      dreamIdleMinutes: 60,
      autoCompactThreshold: 0.8,
    });

    expect(rendered).toContain("[memory]");
    expect(rendered).toContain("daily = true");
    expect(rendered).toContain("sessionMemory = false");
    expect(rendered).toContain("promoteRoot = true");
    expect(rendered).toContain("dreamIdleMinutes = 60");
    expect(rendered).toContain("autoCompactThreshold = 0.8");
  });

  it("loads and renders RTK token saving runtime settings", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "openai_gpt_54_mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"

[runtime]
tokenSavingRtk = true
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "secret" } })).resolves.toMatchObject({
      runtime: {
        tokenSavingRtk: true,
      },
    });

    const rendered = renderRuntimeConfig({
      existingConfigText: await readProjectConfig(cwd),
      tokenSavingRtk: false,
    });

    expect(rendered).toContain("[runtime]");
    expect(rendered).toContain("tokenSavingRtk = false");
  });

  it("loads extension enablement and config without resolving secrets", async () => {
    const cwd = await mkProject(`
[extensions.loopback]
enabled = true
kind = "im"

[extensions.loopback.config]
botTokenEnv = "SCOREL_LOOPBACK_TOKEN"
pollIntervalMs = 1000
`);

    await expect(loadScorelConfigProfile({ cwd, env: {} })).resolves.toMatchObject({
      extensions: {
        loopback: {
          enabled: true,
          kind: "im",
          config: {
            botTokenEnv: "SCOREL_LOOPBACK_TOKEN",
            pollIntervalMs: 1000,
          },
        },
      },
    });
  });

  it("renders extension settings without touching provider or memory config", () => {
    const existing = renderMemoryConfig({
      enabled: true,
      daily: true,
      autoDream: false,
      promoteRoot: false,
      dreamIdleMinutes: 60,
    });

    const rendered = renderExtensionConfig({
      existingConfigText: existing,
      extensionId: "telegram",
      enabled: true,
      kind: "im",
      config: {
        credentialMode: "direct",
        botTokenEnv: "SCOREL_TELEGRAM_BOT_TOKEN",
        apiKey: "123:direct",
        pollIntervalMs: 1000,
        allowedChatIds: "-100,123",
      },
    });

    expect(rendered).toContain("[memory]");
    expect(rendered).toContain("[extensions.telegram]");
    expect(rendered).toContain("enabled = true");
    expect(rendered).toContain('kind = "im"');
    expect(rendered).toContain("[extensions.telegram.config]");
    expect(rendered).toContain('credentialMode = "direct"');
    expect(rendered).toContain('apiKey = "123:direct"');
    expect(rendered).toContain('botTokenEnv = "SCOREL_TELEGRAM_BOT_TOKEN"');
    expect(rendered).toContain("pollIntervalMs = 1000");
    expect(rendered).toContain('allowedChatIds = "-100,123"');
  });

  it("loads custom pi-ai provider models with model metadata", async () => {
    const cwd = await mkProject(`
[providers.chanleramp]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.chanleramp_gpt_54_mini]
provider = "chanleramp"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"
contextWindow = 400000
maxTokens = 128000
reasoning = true
supportsDeveloperRole = true

[available_models.main]
model = "chanleramp_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).resolves.toMatchObject({
      providers: {
        chanleramp: {
          type: "custom",
          api: "openai-completions",
          provider: "chanleramp",
          baseUrl: "https://amp.chanler.dev/v1",
          apiKey: "chanleramp",
        },
      },
      providerModels: {
        chanleramp_gpt_54_mini: {
          provider: "chanleramp",
          id: "gpt-5.4-mini",
          displayName: "GPT 5.4 Mini",
          contextWindow: 400000,
          maxTokens: 128000,
          reasoning: true,
          compat: {
            supportsDeveloperRole: true,
          },
        },
      },
      models: {
        main: { model: "chanleramp_gpt_54_mini", displayName: "GPT 5.4 Mini" },
      },
      modelProfile: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "main",
        },
      },
    });
  });

  it("loads custom pi-ai provider models without generated runtime metadata", async () => {
    const cwd = await mkProject(`
[providers.chanleramp]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.chanleramp_deepseek_v4_pro]
provider = "chanleramp"
id = "deepseek-v4-pro"
displayName = "DeepSeek V4 Pro"

[available_models.deepseek_v4_pro]
model = "chanleramp_deepseek_v4_pro"
displayName = "DeepSeek V4 Pro"

[model_profile.roles]
primary = "deepseek_v4_pro"
standard = "deepseek_v4_pro"
auxiliary = "deepseek_v4_pro"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).resolves.toMatchObject({
      providerModels: {
        chanleramp_deepseek_v4_pro: {
          provider: "chanleramp",
          id: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
        },
      },
      models: {
        deepseek_v4_pro: { model: "chanleramp_deepseek_v4_pro", displayName: "DeepSeek V4 Pro" },
      },
    });
  });

  it("loads direct API key providers and redacts keys from profile listings", async () => {
    const cwd = await mkProject(`
[providers.amp]
type = "custom"
api = "openai-completions"
provider = "AMP/codex/gpt-5.3-codex-spark"
baseUrl = "https://amp.chanler.dev/v1"
apiKey = "direct-secret"

[provider_models.amp_codex_spark]
provider = "amp"
id = "codex/gpt-5.3-codex-spark"
displayName = "Codex Spark"
contextWindow = 128000
maxTokens = 32000
reasoning = false

[available_models.codex_spark]
model = "amp_codex_spark"
displayName = "Codex Spark"

[model_profile.roles]
primary = "codex_spark"
standard = "codex_spark"
auxiliary = "codex_spark"
`);

    await expect(loadScorelConfig({ cwd, env: {} })).resolves.toMatchObject({
      providers: {
        amp: {
          provider: "AMP",
          apiKey: "direct-secret",
        },
      },
    });
    await expect(loadScorelConfigProfile({ cwd, env: {} })).resolves.toMatchObject({
      providers: {
        amp: {
          provider: "AMP",
          credentialSource: "direct",
          credentialStatus: "available",
        },
      },
    });
    const profile = await loadScorelConfigProfile({ cwd, env: {} });
    expect(JSON.stringify(profile)).not.toContain("direct-secret");
  });

  it("rejects provider config when the API key env var is missing", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "openai_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"
`);

    await expect(loadScorelConfig({ cwd, env: {} })).rejects.toThrow("SCOREL_API_KEY is not set");
    await expect(loadScorelConfigProfile({ cwd, env: {} })).resolves.toMatchObject({
      providers: {
        openai: {
          providerId: "openai",
          apiKeyEnv: "SCOREL_API_KEY",
          credentialStatus: "missing",
        },
      },
      models: {
        main: {
          model: "openai_gpt_54_mini",
        },
      },
    });
  });

  it("rejects config keys outside the schema", async () => {
    const cwd = await mkProject(`
sessionsDir = "/tmp/nope"

[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).rejects.toThrow(
      "Unsupported config key: sessionsDir",
    );
  });

  it("rejects config sections outside the schema", async () => {
    const cwd = await mkProject(`
[session]
autoCompactThreshold = 0.7

[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).rejects.toThrow(
      "Unsupported config section: session",
    );
  });

  it("rejects legacy models sections in development-stage config", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[models.main]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).rejects.toThrow(
      "Unsupported config section: models.main",
    );
  });

  it("rejects role assignments outside the available model pool", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "openai_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "missing"
auxiliary = "main"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).rejects.toThrow(
      "model_profile.roles.standard must reference a configured model",
    );
  });

  it("renders GUI-created provider model profiles without embedding secrets", async () => {
    const config = renderModelProfileConfig({
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      modelId: "main",
      providerModelId: "deepseek-v4-flash",
      displayName: "DeepSeek Flash",
    });
    const cwd = await mkProject(config);

    expect(config).toContain('[providers.chanleramp]');
    expect(config).toContain('apiKeyEnv = "SCOREL_API_KEY"');
    expect(config).toContain('baseUrl = "https://amp.chanler.dev/v1"');
    expect(config).not.toContain("contextWindow");
    expect(config).not.toContain("maxTokens");
    expect(config).not.toContain("reasoning");
    expect(config).not.toContain("secret");
    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "secret" } })).resolves.toMatchObject({
      providerModels: {
        chanleramp_main: {
          id: "deepseek-v4-flash",
          displayName: "DeepSeek Flash",
        },
      },
      models: {
        main: {
          model: "chanleramp_main",
          displayName: "DeepSeek Flash",
        },
      },
      modelProfile: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "main",
        },
      },
    });
  });

  it("merges GUI-created provider models into an existing profile", () => {
    const first = renderModelProfileConfig({
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      modelId: "main",
      providerModelId: "deepseek-v4-flash",
      displayName: "DeepSeek Flash",
    });

    const merged = renderModelProfileConfig({
      existingConfigText: first,
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      modelId: "aux",
      providerModelId: "deepseek-v4-lite",
      displayName: "DeepSeek Lite",
      roles: {
        primary: "main",
        standard: "main",
        auxiliary: "aux",
      },
    });

    expect(merged).toContain("[providers.chanleramp]");
    expect(merged).toContain("[provider_models.chanleramp_main]");
    expect(merged).toContain("[provider_models.chanleramp_aux]");
    expect(merged).toContain("[available_models.main]");
    expect(merged).toContain("[available_models.aux]");
    expect(merged).toContain('auxiliary = "aux"');
  });

  it("adds provider models without requiring providerType when provider already exists", () => {
    const first = renderModelProfileConfig({
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
    });

    const merged = renderModelProfileConfig({
      existingConfigText: first,
      providerId: "chanleramp",
      providerModelKey: "chanleramp_deepseek_flash",
      providerModelId: "deepseek-v4-flash",
      displayName: "DeepSeek Flash",
      contextWindow: 128000,
      maxTokens: 32000,
      reasoning: false,
      availableModelId: "deepseek_flash",
      addToAvailable: true,
    });

    expect(merged).toContain("[providers.chanleramp]");
    expect(merged).toContain("[provider_models.chanleramp_deepseek_flash]");
    expect(merged).toContain("[available_models.deepseek_flash]");
  });

  it("updates provider model parameters and removes selected available models", () => {
    const first = renderModelProfileConfig({
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      providerModelKey: "chanleramp_deepseek_flash",
      providerModelId: "deepseek-v4-flash",
      displayName: "DeepSeek Flash",
      availableModelId: "deepseek_flash",
      addToAvailable: true,
    });

    const merged = renderModelProfileConfig({
      existingConfigText: first,
      providerId: "chanleramp",
      providerModelKey: "chanleramp_deepseek_flash",
      providerModelId: "deepseek-v4-flash",
      displayName: "DeepSeek V4 Flash",
      contextWindow: 1000000,
      maxTokens: 128000,
      reasoning: true,
      supportsImageInput: true,
      removeAvailableModelId: "deepseek_flash",
    });

    expect(merged).toContain("[provider_models.chanleramp_deepseek_flash]");
    expect(merged).toContain('displayName = "DeepSeek V4 Flash"');
    expect(merged).toContain("contextWindow = 1000000");
    expect(merged).toContain("maxTokens = 128000");
    expect(merged).toContain("reasoning = true");
    expect(merged).toContain("supportsImageInput = true");
    expect(merged).not.toContain("[available_models.deepseek_flash]");
    expect(merged).not.toContain("[model_profile.roles]");
  });

  it("preserves direct API keys when updating an existing provider without a new key", () => {
    const first = renderModelProfileConfig({
      providerId: "amp",
      providerType: "custom",
      provider: "AMP/codex/gpt-5.3-codex-spark",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKey: "direct-secret",
    });

    const merged = renderModelProfileConfig({
      existingConfigText: first,
      providerId: "amp",
      providerType: "custom",
      provider: "AMP",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
    });

    expect(merged).toContain('provider = "AMP"');
    expect(merged).toContain('apiKey = "direct-secret"');
    expect(merged).not.toContain("apiKeyEnv");
  });

  it("removes a provider and all dependent model profile entries", () => {
    const first = renderModelProfileConfig({
      providerId: "amp",
      providerType: "custom",
      provider: "AMP",
      api: "openai-completions",
      baseUrl: "https://amp.example.test/v1",
      apiKeyEnv: "AMP_KEY",
      availableModelId: "main",
      providerModelKey: "amp_main",
      providerModelId: "amp-main",
      displayName: "AMP Main",
      addToAvailable: true,
      roles: {
        primary: "main",
        standard: "main",
        auxiliary: "main",
      },
    });
    const second = renderModelProfileConfig({
      existingConfigText: first,
      providerId: "backup",
      providerType: "custom",
      provider: "Backup",
      api: "openai-completions",
      baseUrl: "https://backup.example.test/v1",
      apiKeyEnv: "BACKUP_KEY",
      availableModelId: "backup",
      providerModelKey: "backup_main",
      providerModelId: "backup-main",
      displayName: "Backup Main",
      addToAvailable: true,
    });

    const removed = renderModelProfileConfig({
      existingConfigText: second,
      removeProviderId: "amp",
    });

    expect(removed).not.toContain("[providers.amp]");
    expect(removed).not.toContain("[provider_models.amp_main]");
    expect(removed).not.toContain("[available_models.main]");
    expect(removed).toContain("[providers.backup]");
    expect(removed).toContain("[provider_models.backup_main]");
    expect(removed).toContain("[available_models.backup]");
    expect(removed).toContain('primary = "backup"');
    expect(removed).toContain('standard = "backup"');
    expect(removed).toContain('auxiliary = "backup"');
  });

});

const mkProject = async (config: string): Promise<string> => {
  const cwd = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "scorel-config-")));
  await mkdir(join(cwd, ".scorel"));
  await writeFile(join(cwd, ".scorel", "config.toml"), config);
  return cwd;
};

const readProjectConfig = (cwd: string): Promise<string> =>
  readFile(join(cwd, ".scorel", "config.toml"), "utf8");
