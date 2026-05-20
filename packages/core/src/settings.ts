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
export type ScorelMcpStartup = "required" | "optional";

export type ScorelMcpStdioServerConfig = {
  transport: "stdio";
  startup: ScorelMcpStartup;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type ScorelMcpSseServerConfig = {
  transport: "sse";
  startup: ScorelMcpStartup;
  url: string;
  headers?: Record<string, string>;
};

export type ScorelMcpStreamableHttpServerConfig = {
  transport: "streamable-http";
  startup: ScorelMcpStartup;
  url: string;
  headers?: Record<string, string>;
};

export type ScorelMcpServerConfig = ScorelMcpStdioServerConfig | ScorelMcpSseServerConfig | ScorelMcpStreamableHttpServerConfig;

export type ScorelMcpConfig = {
  servers: Record<string, ScorelMcpServerConfig>;
};

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
  mcp: ScorelMcpConfig;
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
  mcp: Partial<{
    servers: Record<string, Partial<ScorelMcpServerConfig>>;
  }>;
}>;

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
  overrides?: ScorelConfigInput;
  globalConfigPath?: string;
  projectConfigPath?: string;
};

export function defaultScorelConfigPath(): string {
  return join(homedir(), ".scorel", "config.toml");
}

export function defaultProjectScorelConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".scorel", "config.toml");
}

export function defaultScorelSessionsDir(): string {
  return join(homedir(), ".scorel", "sessions");
}

export async function loadScorelConfig(options: LoadScorelConfigOptions = {}): Promise<ScorelConfig> {
  const cwd = options.cwd ?? process.cwd();
  const globalConfigPath = options.globalConfigPath ?? defaultScorelConfigPath();
  const projectConfigPath = options.projectConfigPath ?? defaultProjectScorelConfigPath(cwd);

  const layers: ScorelConfigInput[] = [];
  if (await exists(globalConfigPath)) {
    layers.push(await loadTomlConfig(globalConfigPath));
  }
  if (projectConfigPath !== globalConfigPath && await exists(projectConfigPath)) {
    layers.push(await loadTomlConfig(projectConfigPath));
  }
  if (options.overrides) {
    layers.push(options.overrides);
  }

  return normalizeConfig(mergeConfigInputs(...layers));
}

export function resolveScorelModel(
  options: {
    config?: ScorelConfigInput;
  },
  factories: ModelFactories = {}
): ResolvedScorelModel {
  return resolveScorelModelFromConfig(normalizeConfig(options.config ?? {}), factories);
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
      apiKey: customProvider.apiKey,
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
    apiKey: undefined,
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
    channels: input.channels ?? {},
    mcp: normalizeMcp(input.mcp)
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
    channels: objectAt(value.channels),
    mcp: objectAt(value.mcp) as ScorelConfigInput["mcp"]
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
  if (source.mcp) {
    target.mcp = {
      ...target.mcp,
      servers: {
        ...target.mcp?.servers,
        ...definedObject(source.mcp.servers ?? {}) as Record<string, Partial<ScorelMcpServerConfig>>
      }
    };
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

function normalizeMcp(input: ScorelConfigInput["mcp"]): ScorelMcpConfig {
  const servers: Record<string, ScorelMcpServerConfig> = {};
  for (const [serverId, server] of Object.entries(input?.servers ?? {})) {
    if (server.transport === "stdio") {
      if (!server.command) {
        throw new Error(`MCP server ${serverId} must declare command`);
      }
      servers[serverId] = {
        transport: "stdio",
        startup: normalizeMcpStartup(server.startup),
        command: server.command,
        args: Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === "string") : undefined,
        cwd: stringOrUndefined(server.cwd),
        env: stringRecordOrUndefined(server.env)
      };
      continue;
    }
    if (server.transport === "sse" || server.transport === "streamable-http") {
      if (!server.url) {
        throw new Error(`MCP server ${serverId} must declare url`);
      }
      servers[serverId] = {
        transport: server.transport,
        startup: normalizeMcpStartup(server.startup),
        url: server.url,
        headers: stringRecordOrUndefined(server.headers)
      };
      continue;
    }
    throw new Error(`MCP server ${serverId} has unsupported transport ${String(server.transport)}`);
  }
  return { servers };
}

function normalizeMcpStartup(value: unknown): ScorelMcpStartup {
  if (value === undefined) {
    return "optional";
  }
  if (value === "required" || value === "optional") {
    return value;
  }
  throw new Error(`Invalid MCP startup: ${String(value)}`);
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

function stringRecordOrUndefined(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
