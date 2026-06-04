import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SCOREL_CONFIG_SCHEMA = {
  fixedPaths: {
    userRoot: "~/.scorel",
    userConfig: "~/.scorel/config.toml",
    sessionsDir: "~/.scorel/sessions",
    projectConfig: ".scorel/config.toml",
  },
  sections: {
    root: {
      keys: [],
    },
    model: {
      keys: [
        "type",
        "provider",
        "id",
        "api",
        "baseUrl",
        "apiKeyEnv",
        "contextWindow",
        "maxTokens",
        "reasoning",
        "supportsDeveloperRole",
      ],
    },
  },
} as const;

export type BuiltinPiAiModelConfig = {
  type: "builtin";
  provider: string;
  id: string;
  apiKey: string;
  baseUrl?: string;
};

export type CustomPiAiApi = "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";

export type CustomPiAiModelConfig = {
  type: "custom";
  api: CustomPiAiApi;
  provider: string;
  id: string;
  baseUrl: string;
  apiKey: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  compat?: {
    supportsDeveloperRole?: boolean;
  };
};

export type ScorelConfig = {
  model: BuiltinPiAiModelConfig | CustomPiAiModelConfig;
};

export const scorelUserRoot = (homeDir: string): string => join(homeDir, ".scorel");

export const scorelUserConfigPath = (homeDir: string): string => join(scorelUserRoot(homeDir), "config.toml");

export const scorelSessionsDir = (homeDir: string): string => join(scorelUserRoot(homeDir), "sessions");

export const scorelProjectConfigPath = (cwd: string): string => join(cwd, ".scorel", "config.toml");

export type LoadScorelConfigOptions = {
  cwd: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
};

type RawConfig = {
  model?: {
    type?: string;
    provider?: string;
    id?: string;
    api?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    supportsDeveloperRole?: boolean;
  };
};

type ConfigSection = keyof typeof SCOREL_CONFIG_SCHEMA.sections;
type ConfigValue = string | number | boolean;

export const loadScorelConfig = async (options: LoadScorelConfigOptions): Promise<ScorelConfig> => {
  const env = options.env ?? process.env;
  const raw = parseToml(await readConfigText(options));
  const model = raw.model;
  if (!model) {
    throw new Error("model config is required");
  }

  const apiKeyEnv = requireString(model.apiKeyEnv, "model.apiKeyEnv");
  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${apiKeyEnv} is not set`);
  }

  if (model.type === "builtin") {
    return {
      model: {
        type: "builtin",
        provider: requireString(model.provider, "model.provider"),
        id: requireString(model.id, "model.id"),
        ...(model.baseUrl ? { baseUrl: stripTrailingSlashes(model.baseUrl) } : {}),
        apiKey,
      },
    };
  }

  if (model.type === "custom") {
    const api = requireCustomApi(model.api);
    return {
      model: {
        type: "custom",
        api,
        provider: requireString(model.provider, "model.provider"),
        id: requireString(model.id, "model.id"),
        baseUrl: stripTrailingSlashes(requireString(model.baseUrl, "model.baseUrl")),
        contextWindow: requireNumber(model.contextWindow, "model.contextWindow"),
        maxTokens: requireNumber(model.maxTokens, "model.maxTokens"),
        reasoning: requireBoolean(model.reasoning, "model.reasoning"),
        ...(model.supportsDeveloperRole === undefined
          ? {}
          : { compat: { supportsDeveloperRole: requireBoolean(model.supportsDeveloperRole, "model.supportsDeveloperRole") } }),
        apiKey,
      },
    };
  }

  throw new Error("model.type must be builtin or custom");
};

const readConfigText = async (options: LoadScorelConfigOptions): Promise<string> => {
  const projectPath = scorelProjectConfigPath(options.cwd);
  try {
    return await readFile(projectPath, "utf8");
  } catch {
    const home = options.homeDir ?? process.env.HOME;
    if (!home) {
      throw new Error(`Scorel config not found: ${projectPath}`);
    }
    const userPath = scorelUserConfigPath(home);
    try {
      return await readFile(userPath, "utf8");
    } catch {
      throw new Error(`Scorel config not found: ${projectPath} or ${userPath}`);
    }
  }
};

const parseToml = (text: string): RawConfig => {
  const result: RawConfig = {};
  let section: ConfigSection = "root";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_-]+)\]$/.exec(line);
    if (sectionMatch) {
      section = requireSection(sectionMatch[1] ?? "");
      ensureSection(result, section);
      continue;
    }

    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) {
      throw new Error(`Unsupported config line: ${rawLine.trim()}`);
    }
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) {
      throw new Error(`Unsupported config line: ${rawLine.trim()}`);
    }
    setConfigValue(result, section, key, parseTomlValue(rawValue));
  }

  return result;
};

const stripComment = (line: string): string => {
  const index = line.indexOf("#");
  return index === -1 ? line : line.slice(0, index);
};

const requireString = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requireNumber = (value: number | undefined, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requireBoolean = (value: boolean | undefined, name: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requireCustomApi = (value: string | undefined): CustomPiAiApi => {
  if (
    value === "openai-completions" ||
    value === "openai-responses" ||
    value === "google-generative-ai" ||
    value === "anthropic-messages"
  ) {
    return value;
  }
  throw new Error("model.api must be openai-completions, openai-responses, google-generative-ai, or anthropic-messages");
};

const requireSection = (section: string): ConfigSection => {
  if (section in SCOREL_CONFIG_SCHEMA.sections) {
    return section as ConfigSection;
  }
  throw new Error(`Unsupported config section: ${section}`);
};

const ensureSection = (config: RawConfig, section: ConfigSection): void => {
  if (section === "model") {
    config.model ??= {};
  }
};

const setConfigValue = (config: RawConfig, section: ConfigSection, key: string, value: ConfigValue): void => {
  assertKnownKey(section, key);
  if (section === "model") {
    config.model ??= {};
    setModelValue(config.model, key, value);
  }
};

const assertKnownKey = (section: ConfigSection, key: string): void => {
  const allowed = SCOREL_CONFIG_SCHEMA.sections[section].keys;
  if (!(allowed as readonly string[]).includes(key)) {
    throw new Error(`Unsupported config key: ${key}`);
  }
};

const setModelValue = (model: NonNullable<RawConfig["model"]>, key: string, value: ConfigValue): void => {
  (model as Record<string, ConfigValue | undefined>)[key] = value;
};

const parseTomlValue = (value: string): ConfigValue => {
  const stringMatch = /^"([^"]*)"$/.exec(value);
  if (stringMatch) {
    return stringMatch[1] ?? "";
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }
  throw new Error(`Unsupported config value: ${value}`);
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");
