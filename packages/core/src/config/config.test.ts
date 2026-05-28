import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCOREL_CONFIG_SCHEMA,
  loadScorelConfig,
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

  it("loads builtin pi-ai model config from project .scorel/config.toml", async () => {
    const cwd = await mkProject(`
[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).resolves.toEqual({
      model: {
        type: "builtin",
        provider: "openai",
        id: "gpt-5.4-mini",
        apiKey: "chanleramp",
      },
    });
  });

  it("loads custom pi-ai model config separately from builtin providers", async () => {
    const cwd = await mkProject(`
[model]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
id = "gpt-5.4-mini"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"
contextWindow = 400000
maxTokens = 128000
reasoning = true
`);

    await expect(loadScorelConfig({ cwd, env: { SCOREL_API_KEY: "chanleramp" } })).resolves.toEqual({
      model: {
        type: "custom",
        api: "openai-completions",
        provider: "chanleramp",
        id: "gpt-5.4-mini",
        baseUrl: "https://amp.chanler.dev/v1",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      },
    });
  });

  it("rejects real model config when the API key env var is missing", async () => {
    const cwd = await mkProject(`
[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
`);

    await expect(loadScorelConfig({ cwd, env: {} })).rejects.toThrow("SCOREL_API_KEY is not set");
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
});

const mkProject = async (config: string): Promise<string> => {
  const cwd = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "scorel-config-")));
  await mkdir(join(cwd, ".scorel"));
  await writeFile(join(cwd, ".scorel", "config.toml"), config);
  return cwd;
};
