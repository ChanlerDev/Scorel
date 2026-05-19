import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  createOpenAICompatibleChatModel,
  getModel as defaultGetModel,
  getProviders as defaultGetProviders
} from "./llm.js";
import type { Api, Model } from "./llm.js";
import type { ScorelTool } from "./types.js";

export type ScorelToolPreset = "none" | "readonly" | "coding" | "all";
export type ScorelCustomProtocol = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export type ScorelModelRef = {
  providerId: string;
  modelId: string;
};

export type ScorelCustomModelMetadata = {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: Array<"text" | "image">;
  reasoning?: boolean;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  compat?: Model<"openai-completions">["compat"];
};

export type ScorelCustomProviderConfig = {
  protocol: ScorelCustomProtocol;
  baseUrl: string;
  apiKey?: string;
  models?: Record<string, ScorelCustomModelMetadata>;
};

export type ScorelConfig = {
  agent: {
    systemPrompt?: string;
    instructions?: string;
  };
  providers: Record<string, ScorelCustomProviderConfig>;
  model: ScorelModelRef;
  models: {
    available: ScorelModelRef[];
  };
  session: {
    dir: string;
  };
  tools: {
    preset: ScorelToolPreset;
  };
  channels: Record<string, unknown>;
};

export type ScorelConfigInput = Partial<{
  agent: Partial<ScorelConfig["agent"]>;
  providers: Record<string, Partial<ScorelCustomProviderConfig>>;
  model: Partial<ScorelModelRef>;
  models: Partial<{
    default: Partial<ScorelModelRef>;
    available: Array<Partial<ScorelModelRef>>;
  }>;
  session: Partial<ScorelConfig["session"]> & { sessionsDir?: string };
  tools: Partial<ScorelConfig["tools"]>;
  channels: Record<string, unknown>;
}>;

export type ScorelModelSettings = {
  provider?: string;
  id?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type ScorelSettings = {
  model: Required<Pick<ScorelModelSettings, "provider" | "id">> & Omit<ScorelModelSettings, "provider" | "id">;
  sessionsDir: string;
};

export type ScorelSettingsInput = {
  model?: ScorelModelSettings;
  sessionsDir?: string;
};

export type ScorelEnvironment = Record<string, string | undefined>;

export type ResolvedScorelModel = {
  model: Model<Api>;
  provider: string;
  modelId: string;
  apiKey?: string;
};

type ModelFactories = {
  getProviders?: () => string[];
  getModel?: (provider: string, modelId: string) => Model<Api> | undefined;
  createOpenAICompatibleChatModel?: (options: {
    id: string;
    baseUrl: string;
    provider?: string;
    name?: string;
    metadata?: Partial<Model<"openai-completions">>;
  }) => Model<Api>;
};

export type LoadScorelConfigOptions = {
  cwd?: string;
  env?: ScorelEnvironment;
  overrides?: ScorelConfigInput;
  globalConfigPath?: string;
  projectConfigPath?: string;
  legacySettingsPath?: string;
};

export function defaultScorelSettingsPath(env: ScorelEnvironment = process.env): string {
  return env.SCOREL_SETTINGS ?? join(homedir(), ".scorel", "settings.json");
}

export function defaultScorelConfigPath(): string {
  return join(homedir(), ".scorel", "config.toml");
}

export function defaultProjectScorelConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".scorel", "config.toml");
}

export function defaultScorelSessionsDir(): string {
  return join(homedir(), ".scorel", "sessions");
}

export async function loadScorelSettings(path = defaultScorelSettingsPath()): Promise<ScorelSettings> {
  if (!(await exists(path))) {
    return normalizeSettings({});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid Scorel settings JSON at ${path}: ${error.message}`);
    }
    throw error;
  }

  if (!isObject(parsed)) {
    throw new Error(`Invalid Scorel settings at ${path}: expected a JSON object`);
  }
  return normalizeSettings(parsed);
}

export async function loadScorelConfig(options: LoadScorelConfigOptions = {}): Promise<ScorelConfig> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const legacySettingsPath = options.legacySettingsPath ?? defaultScorelSettingsPath(env);
  const globalConfigPath = options.globalConfigPath ?? env.SCOREL_CONFIG ?? defaultScorelConfigPath();
  const projectConfigPath = options.projectConfigPath ?? defaultProjectScorelConfigPath(cwd);

  const layers: ScorelConfigInput[] = [];
  if (await exists(legacySettingsPath)) {
    layers.push(settingsToConfigInput(await loadScorelSettings(legacySettingsPath)));
  }
  if (await exists(globalConfigPath)) {
    layers.push(await loadTomlConfig(globalConfigPath));
  }
  if (projectConfigPath !== globalConfigPath && await exists(projectConfigPath)) {
    layers.push(await loadTomlConfig(projectConfigPath));
  }
  layers.push(envToConfigInput(env));
  if (options.overrides) {
    layers.push(options.overrides);
  }

  const merged = mergeConfigInputs(...layers);
  applyResolvedEnvOverrides(merged, env);
  return normalizeConfig(merged);
}

export function resolveScorelModel(
  options: {
    env?: ScorelEnvironment;
    settings?: ScorelSettingsInput;
    config?: ScorelConfigInput;
  },
  factories: ModelFactories = {}
): ResolvedScorelModel {
  if (options.config) {
    return resolveScorelModelFromConfig(normalizeConfig(options.config), options.env ?? {}, factories);
  }

  const env = options.env ?? process.env;
  const settings = normalizeSettings(options.settings ?? {});
  const provider = env.SCOREL_PROVIDER ?? settings.model.provider;
  const modelId = env.SCOREL_MODEL ?? settings.model.id;
  const baseUrl = env.SCOREL_BASE_URL ?? settings.model.baseUrl;
  const apiKey = env.SCOREL_API_KEY ?? settings.model.apiKey ?? (provider === "openai" ? env.OPENAI_API_KEY : undefined);
  const makeKnownModel = factories.getModel ?? ((knownProvider, knownModelId) => defaultGetModel(knownProvider as never, knownModelId as never) as Model<Api>);
  const makeOpenAICompatible = factories.createOpenAICompatibleChatModel ?? createOpenAICompatibleChatModel;

  return {
    provider,
    modelId,
    apiKey,
    model: baseUrl
      ? makeOpenAICompatible({ provider, id: modelId, baseUrl })
      : requireModel(makeKnownModel(provider, modelId), provider, modelId)
  };
}

export async function discoverOpenAICompatibleModels(options: {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<string[]> {
  const fetchFn = options.fetch ?? fetch;
  const response = await fetchFn(`${options.baseUrl.replace(/\/$/, "")}/models`, {
    headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined
  });
  if (!response.ok) {
    throw new Error(`Failed to discover models from ${options.baseUrl}: HTTP ${response.status}`);
  }
  const data = await response.json() as { data?: Array<{ id?: unknown }> };
  return (data.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string");
}

export async function buildSystemPrompt(options: {
  config: ScorelConfigInput;
  cwd?: string;
  now?: Date;
}): Promise<string> {
  const config = normalizeConfig(options.config);
  const cwd = options.cwd ?? process.cwd();
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  return [
    config.agent.systemPrompt,
    `cwd: ${cwd}`,
    `date: ${date}`,
    config.agent.instructions
  ].filter((part): part is string => Boolean(part && part.trim().length > 0)).join("\n\n");
}

export function selectScorelTools(
  preset: ScorelToolPreset,
  options: { readonlyTools: ScorelTool[]; writeTools: ScorelTool[] }
): ScorelTool[] {
  if (preset === "none") {
    return [];
  }
  if (preset === "readonly") {
    return options.readonlyTools;
  }
  return [...options.readonlyTools, ...options.writeTools];
}

function resolveScorelModelFromConfig(
  config: ScorelConfig,
  env: ScorelEnvironment,
  factories: ModelFactories
): ResolvedScorelModel {
  const getProviders = factories.getProviders ?? defaultGetProviders;
  const builtInProviders = new Set(getProviders());
  for (const providerId of Object.keys(config.providers)) {
    if (builtInProviders.has(providerId)) {
      throw new Error(`Custom provider ${providerId} shadows a built-in provider`);
    }
  }

  const { providerId, modelId } = config.model;
  if (!config.models.available.some((model) => model.providerId === providerId && model.modelId === modelId)) {
    throw new Error(`Model ${providerId}/${modelId} is not in models.available`);
  }

  const customProvider = config.providers[providerId];
  if (customProvider) {
    const metadata = customProvider.models?.[modelId];
    const makeOpenAICompatible = factories.createOpenAICompatibleChatModel ?? createOpenAICompatibleChatModel;
    return {
      provider: providerId,
      modelId,
      apiKey: env.SCOREL_API_KEY ?? customProvider.apiKey,
      model: makeOpenAICompatible({
        provider: providerId,
        id: modelId,
        baseUrl: customProvider.baseUrl,
        name: metadata?.name,
        metadata: metadata as Partial<Model<"openai-completions">> | undefined
      })
    };
  }

  const makeKnownModel = factories.getModel ?? ((knownProvider, knownModelId) => defaultGetModel(knownProvider as never, knownModelId as never) as Model<Api>);
  return {
    provider: providerId,
    modelId,
    apiKey: env.SCOREL_API_KEY ?? (providerId === "openai" ? env.OPENAI_API_KEY : undefined),
    model: requireModel(makeKnownModel(providerId, modelId), providerId, modelId)
  };
}

function normalizeConfig(input: ScorelConfigInput): ScorelConfig {
  const model = normalizeModelRef(input.model ?? input.models?.default ?? {});
  const available = (input.models?.available?.length ? input.models.available : [model]).map(normalizeModelRef);
  const providers = normalizeProviders(input.providers ?? {});
  return {
    agent: {
      systemPrompt: stringOrUndefined(input.agent?.systemPrompt),
      instructions: stringOrUndefined(input.agent?.instructions)
    },
    providers,
    model,
    models: { available },
    session: {
      dir: input.session?.dir ?? input.session?.sessionsDir ?? defaultScorelSessionsDir()
    },
    tools: {
      preset: normalizeToolPreset(input.tools?.preset)
    },
    channels: input.channels ?? {}
  };
}

function normalizeSettings(input: ScorelSettingsInput): ScorelSettings {
  return {
    model: {
      provider: input.model?.provider ?? "openai",
      id: input.model?.id ?? "gpt-4o-mini",
      baseUrl: input.model?.baseUrl,
      apiKey: input.model?.apiKey
    },
    sessionsDir: input.sessionsDir ?? defaultScorelSessionsDir()
  };
}

function settingsToConfigInput(settings: ScorelSettings): ScorelConfigInput {
  const providerId = settings.model.provider;
  const modelId = settings.model.id;
  return {
    providers: settings.model.baseUrl
      ? {
          [providerId]: {
            protocol: "openai-completions",
            baseUrl: settings.model.baseUrl,
            apiKey: settings.model.apiKey
          }
        }
      : {},
    models: {
      default: { providerId, modelId },
      available: [{ providerId, modelId }]
    },
    session: { dir: settings.sessionsDir }
  };
}

async function loadTomlConfig(path: string): Promise<ScorelConfigInput> {
  try {
    const parsed = parseToml(await readFile(path, "utf8"));
    if (!isObject(parsed)) {
      throw new Error("expected a TOML table");
    }
    return tomlToConfigInput(parsed);
  } catch (error) {
    throw new Error(`Invalid Scorel config TOML at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function tomlToConfigInput(value: Record<string, unknown>): ScorelConfigInput {
  const modelDefault = objectAt(objectAt(value.models)?.default);
  const availableRaw = objectAt(value.models)?.available;
  return {
    agent: objectAt(value.agent) as ScorelConfigInput["agent"],
    providers: objectAt(value.providers) as ScorelConfigInput["providers"],
    models: {
      default: modelDefault
        ? {
            providerId: stringOrUndefined(modelDefault.providerId ?? modelDefault.provider),
            modelId: stringOrUndefined(modelDefault.modelId ?? modelDefault.id)
          }
        : undefined,
      available: Array.isArray(availableRaw)
        ? availableRaw.map((item) => {
            const model = objectAt(item) ?? {};
            return {
              providerId: stringOrUndefined(model.providerId ?? model.provider),
              modelId: stringOrUndefined(model.modelId ?? model.id)
            };
          })
        : undefined
    },
    session: objectAt(value.session) as ScorelConfigInput["session"],
    tools: objectAt(value.tools) as ScorelConfigInput["tools"],
    channels: objectAt(value.channels)
  };
}

function envToConfigInput(env: ScorelEnvironment): ScorelConfigInput {
  const input: ScorelConfigInput = {};
  if (env.SCOREL_PROVIDER || env.SCOREL_MODEL || env.SCOREL_BASE_URL) {
    const providerId = env.SCOREL_PROVIDER;
    const modelId = env.SCOREL_MODEL;
    if (providerId || modelId) {
      input.model = { providerId, modelId };
      input.models = { default: { providerId, modelId } };
    }
    if (env.SCOREL_BASE_URL) {
      const provider = providerId ?? "openai";
      input.providers = {
        [provider]: {
          protocol: "openai-completions",
          baseUrl: env.SCOREL_BASE_URL,
          apiKey: env.SCOREL_API_KEY
        }
      };
    }
  }
  return input;
}

function applyResolvedEnvOverrides(config: ScorelConfigInput, env: ScorelEnvironment): void {
  if (!env.SCOREL_API_KEY) {
    return;
  }
  const providerId = config.model?.providerId ?? config.models?.default?.providerId;
  if (!providerId || !config.providers?.[providerId]) {
    return;
  }
  config.providers[providerId] = {
    ...config.providers[providerId],
    apiKey: env.SCOREL_API_KEY
  };
}

function mergeConfigInputs(...layers: ScorelConfigInput[]): ScorelConfigInput {
  const result: ScorelConfigInput = {};
  for (const layer of layers) {
    mergeInto(result, layer);
  }
  return result;
}

function mergeInto(target: ScorelConfigInput, source: ScorelConfigInput): void {
  if (source.agent) {
    target.agent = { ...target.agent, ...definedObject(source.agent) };
  }
  if (source.providers) {
    target.providers = { ...target.providers };
    for (const [providerId, provider] of Object.entries(source.providers)) {
      target.providers[providerId] = { ...target.providers[providerId], ...definedObject(provider) };
    }
  }
  if (source.model) {
    const modelOverride = definedObject(source.model);
    if (Object.keys(modelOverride).length > 0) {
      target.model = { ...target.model, ...modelOverride };
      target.models = { ...target.models, default: { ...target.models?.default, ...modelOverride } };
    }
  }
  if (source.models) {
    target.models = {
      ...target.models,
      default: source.models.default ? { ...target.models?.default, ...definedObject(source.models.default) } : target.models?.default,
      available: source.models.available ?? target.models?.available
    };
  }
  if (source.session) {
    target.session = { ...target.session, ...definedObject(source.session) };
  }
  if (source.tools) {
    target.tools = { ...target.tools, ...definedObject(source.tools) };
  }
  if (source.channels) {
    target.channels = { ...target.channels, ...source.channels };
  }
}

function normalizeModelRef(input: Partial<ScorelModelRef>): ScorelModelRef {
  return {
    providerId: input.providerId ?? "openai",
    modelId: input.modelId ?? "gpt-4o-mini"
  };
}

function normalizeProviders(input: Record<string, Partial<ScorelCustomProviderConfig>>): Record<string, ScorelCustomProviderConfig> {
  const providers: Record<string, ScorelCustomProviderConfig> = {};
  for (const [providerId, provider] of Object.entries(input)) {
    if (!provider.protocol) {
      throw new Error(`Custom provider ${providerId} must declare protocol`);
    }
    if (!provider.baseUrl) {
      throw new Error(`Custom provider ${providerId} must declare baseUrl`);
    }
    if (!isSupportedProtocol(provider.protocol)) {
      throw new Error(`Custom provider ${providerId} has unsupported protocol ${provider.protocol}`);
    }
    providers[providerId] = {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      models: provider.models as Record<string, ScorelCustomModelMetadata> | undefined
    };
  }
  return providers;
}

function normalizeToolPreset(value: unknown): ScorelToolPreset {
  if (value === undefined) {
    return "coding";
  }
  if (value === "none" || value === "readonly" || value === "coding" || value === "all") {
    return value;
  }
  throw new Error(`Invalid tools preset: ${String(value)}`);
}

function isSupportedProtocol(value: unknown): value is ScorelCustomProtocol {
  return value === "openai-completions" || value === "openai-responses" || value === "anthropic-messages" || value === "google-generative-ai";
}

function requireModel(model: Model<Api> | undefined, provider: string, modelId: string): Model<Api> {
  if (!model) {
    throw new Error(`Unknown model ${provider}/${modelId}`);
  }
  return model;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
