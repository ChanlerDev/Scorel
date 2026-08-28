import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SCOREL_CONFIG_SCHEMA = {
  fixedPaths: {
    userRoot: "~/.scorel",
    userConfig: "~/.scorel/config.toml",
    sessionsDir: "~/.scorel/sessions",
  },
  sections: {
    root: {
      keys: [],
    },
    provider: {
      keys: ["type", "provider", "api", "baseUrl", "apiKeyEnv", "apiKey"],
    },
    providerModel: {
      keys: ["provider", "id", "displayName", "contextWindow", "maxTokens", "reasoning", "supportsDeveloperRole", "supportsImageInput"],
    },
    availableModel: {
      keys: ["model", "displayName"],
    },
    modelProfileRoles: {
      keys: ["primary", "standard", "auxiliary"],
    },
    memory: {
      keys: ["enabled", "daily", "sessionMemory", "autoDream", "promoteRoot", "dreamIdleMinutes", "autoCompactThreshold"],
    },
    runtime: {
      keys: ["tokenSavingRtk"],
    },
    taskBudget: {
      keys: ["maxTokens", "maxCostUsd", "maxWallClockMinutes", "repeatedCommandThreshold", "staleProgressMinutes"],
    },
    observability: {
      keys: ["local"],
    },
    observabilitySync: {
      keys: ["enabled", "mode", "targets"],
    },
    observabilityLangfuse: {
      keys: ["enabled", "host", "publicKey", "secretKey"],
    },
    observabilityOtel: {
      keys: ["enabled", "endpoint", "protocol"],
    },
    extension: {
      keys: ["enabled", "kind"],
    },
    extensionConfig: {
      keys: [],
    },
    mcpServer: {
      keys: ["transport", "command", "args", "env", "cwd", "url", "headers", "envHeaders"],
    },
  },
} as const;

export type ModelRole = "primary" | "standard" | "auxiliary";

export type BuiltinPiAiProviderConfig = {
  type: "builtin";
  provider: string;
  apiKey: string;
  baseUrl?: string;
};

export type CustomPiAiApi = "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";

export type CustomPiAiProviderConfig = {
  type: "custom";
  api: CustomPiAiApi;
  provider: string;
  baseUrl: string;
  apiKey: string;
};

export type ScorelProviderConfig = BuiltinPiAiProviderConfig | CustomPiAiProviderConfig;

export type ProviderModelConfig = {
  provider: string;
  id: string;
  displayName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsImageInput?: boolean;
  compat?: {
    supportsDeveloperRole?: boolean;
  };
};

export type AvailableModelConfig = {
  model: string;
  displayName?: string;
};

export type BuiltinPiAiModelConfig = BuiltinPiAiProviderConfig & {
  id: string;
  displayName?: string;
};

export type CustomPiAiModelConfig = CustomPiAiProviderConfig & {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsImageInput?: boolean;
  compat?: {
    supportsDeveloperRole?: boolean;
  };
};

export type ScorelConfig = {
  providers: Record<string, ScorelProviderConfig>;
  providerModels: Record<string, ProviderModelConfig>;
  models: Record<string, AvailableModelConfig>;
  modelProfile: {
    roles: Record<ModelRole, string>;
  };
  memory: MemoryConfig;
  runtime: RuntimeConfig;
  taskBudget: TaskBudgetConfig;
  observability?: ObservabilityConfig;
  extensions: Record<string, ExtensionConfig>;
  mcpServers: Record<string, McpServerConfigEntry>;
};

export type MemoryConfig = {
  enabled: boolean;
  daily: boolean;
  sessionMemory: boolean;
  autoDream: boolean;
  promoteRoot: boolean;
  dreamIdleMinutes: number;
  autoCompactThreshold: number;
};

export type RuntimeConfig = {
  tokenSavingRtk: boolean;
};

export type TaskBudgetConfig = {
  maxTokens: number;
  maxCostUsd: number;
  maxWallClockMinutes: number;
  repeatedCommandThreshold: number;
  staleProgressMinutes: number;
};

export type ObservabilityTarget = "langfuse" | "otel";

export type ObservabilityConfig = {
  local: boolean;
  sync: {
    enabled: boolean;
    mode: "manual" | "auto";
    targets: ObservabilityTarget[];
  };
  langfuse: {
    enabled: boolean;
    host?: string;
    publicKey?: string;
    secretKey?: string;
  };
  otel: {
    enabled: boolean;
    endpoint?: string;
    protocol: "otlp-http";
  };
};

export type ExtensionConfig = {
  enabled: boolean;
  kind: "im";
  config: Record<string, string | number | boolean>;
};

export type McpServerConfigEntry = {
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envHeaders?: Record<string, string>;
};

export type UpsertMcpServerInput = {
  serverId: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envHeaders?: Record<string, string>;
  existingConfigText?: string;
};

export type RemoveMcpServerInput = {
  serverId: string;
  existingConfigText?: string;
};

export type ProviderConnectionSummary = {
  providerId: string;
  type: "builtin" | "custom";
  provider: string;
  api?: CustomPiAiApi;
  baseUrl?: string;
  apiKeyEnv?: string;
  credentialSource: "env" | "direct";
  credentialStatus: "available" | "missing";
};

type ProviderProfileConfig = ProviderConnectionSummary & {
  apiKey?: string;
};

export type ScorelConfigProfile = {
  providers: Record<string, ProviderProfileConfig>;
  providerModels: Record<string, ProviderModelConfig>;
  models: Record<string, AvailableModelConfig>;
  modelProfile: {
    roles: Record<ModelRole, string>;
  };
  memory: MemoryConfig;
  runtime: RuntimeConfig;
  taskBudget: TaskBudgetConfig;
  observability?: ObservabilityConfig;
  extensions: Record<string, ExtensionConfig>;
  mcpServers: Record<string, McpServerConfigEntry>;
  warnings?: string[];
};

export type AvailableModelSummary = {
  modelId: string;
  providerModelId: string;
  providerId: string;
  provider: string;
  id: string;
  displayName: string;
  roles: ModelRole[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
};

export type ProviderModelSummary = {
  providerModelId: string;
  providerId: string;
  provider: string;
  id: string;
  displayName: string;
  availableModelIds: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
};

export type ResolvedModelSelection = {
  modelId: string;
  role?: ModelRole;
  displayName: string;
  providerId: string;
  config: BuiltinPiAiModelConfig | CustomPiAiModelConfig;
};

export type UpsertModelProfileConfigInput = {
  providerId?: string;
  removeProviderId?: string;
  providerType?: "builtin" | "custom";
  provider?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  api?: CustomPiAiApi;
  baseUrl?: string;
  modelId?: string;
  providerModelKey?: string;
  availableModelId?: string;
  addToAvailable?: boolean;
  removeAvailableModelId?: string;
  providerModelId?: string;
  displayName?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
  roles?: Partial<Record<ModelRole, string>>;
  existingConfigText?: string;
};

export type UpsertMemoryConfigInput = Partial<MemoryConfig> & {
  existingConfigText?: string;
};

export type UpsertRuntimeConfigInput = Partial<RuntimeConfig> & {
  existingConfigText?: string;
};

export type UpsertTaskBudgetConfigInput = Partial<TaskBudgetConfig> & {
  existingConfigText?: string;
};

export type UpsertObservabilityConfigInput = {
  local?: boolean;
  sync?: Partial<ObservabilityConfig["sync"]>;
  langfuse?: Partial<ObservabilityConfig["langfuse"]>;
  otel?: Partial<ObservabilityConfig["otel"]>;
  existingConfigText?: string;
};

export type ConfigValue = string | number | boolean | string[];

export type UpsertExtensionConfigInput = {
  extensionId: string;
  enabled?: boolean;
  kind?: "im";
  config?: Record<string, string | number | boolean | undefined>;
  existingConfigText?: string;
};

export const scorelUserRoot = (homeDir: string): string => join(homeDir, ".scorel");

export const scorelUserConfigPath = (homeDir: string): string => join(scorelUserRoot(homeDir), "config.toml");

export const scorelSessionsDir = (homeDir: string): string => join(scorelUserRoot(homeDir), "sessions");

export type LoadScorelConfigOptions = {
  cwd: string;
  homeDir?: string;
  scorelHomeDir?: string;
  env?: Record<string, string | undefined>;
};

type RawConfig = {
  providers: Record<string, {
    type?: string;
    provider?: string;
    api?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    apiKey?: string;
  }>;
  providerModels: Record<string, {
    provider?: string;
    id?: string;
    displayName?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    supportsDeveloperRole?: boolean;
    supportsImageInput?: boolean;
  }>;
  availableModels: Record<string, {
    model?: string;
    displayName?: string;
  }>;
  modelProfile?: {
    roles?: Partial<Record<ModelRole, string>>;
  };
  memory?: Partial<MemoryConfig>;
  runtime?: Partial<RuntimeConfig>;
  taskBudget?: Partial<TaskBudgetConfig>;
  observability?: {
    local?: boolean;
  };
  observabilitySync?: {
    enabled?: boolean;
    mode?: string;
    targets?: string;
  };
  observabilityLangfuse?: {
    enabled?: boolean;
    host?: string;
    publicKey?: string;
    secretKey?: string;
  };
  observabilityOtel?: {
    enabled?: boolean;
    endpoint?: string;
    protocol?: string;
  };
  extensions: Record<string, {
    enabled?: boolean;
    kind?: string;
    config?: Record<string, string | number | boolean>;
  }>;
  mcpServers: Record<string, {
    transport?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    envHeaders?: Record<string, string>;
  }>;
};

type ConfigSection =
  | { kind: "root" }
  | { kind: "provider"; id: string }
  | { kind: "providerModel"; id: string }
  | { kind: "availableModel"; id: string }
  | { kind: "modelProfileRoles" }
  | { kind: "memory" }
  | { kind: "runtime" }
  | { kind: "taskBudget" }
  | { kind: "observability" }
  | { kind: "observabilitySync" }
  | { kind: "observabilityLangfuse" }
  | { kind: "observabilityOtel" }
  | { kind: "extension"; id: string }
  | { kind: "extensionConfig"; id: string }
  | { kind: "mcpServer"; id: string }
  | { kind: "mcpServerEnv"; id: string }
  | { kind: "mcpServerHeaders"; id: string }
  | { kind: "mcpServerEnvHeaders"; id: string }
  | { kind: "ignored" };
export const loadScorelConfig = async (options: LoadScorelConfigOptions): Promise<ScorelConfig> => {
  const env = options.env ?? process.env;
  const raw = parseToml(await readConfigText(options));
  const providers = loadProviders(raw, env);
  const providerModels = loadProviderModels(raw, providers);
  const models = loadAvailableModels(raw, providerModels);
  const roles = loadRoles(raw, models);

  return {
    providers,
    providerModels,
    models,
    modelProfile: { roles },
    memory: loadMemory(raw),
    runtime: loadRuntime(raw),
    taskBudget: loadTaskBudget(raw),
    observability: loadObservability(raw),
    extensions: loadExtensions(raw),
    mcpServers: loadMcpServers(raw),
  };
};

export const loadScorelConfigProfile = async (options: LoadScorelConfigOptions & { includeSecrets?: boolean }): Promise<ScorelConfigProfile> => {
  const env = options.env ?? process.env;
  const raw = parseToml(await readConfigText(options));
  const providers = loadProviderProfiles(raw, env, { includeSecrets: options.includeSecrets ?? false });
  const providerModels = loadProviderModels(raw, providers, { requireAny: false });
  const models = loadAvailableModels(raw, providerModels, { requireAny: false, includeAllProviderModels: false });
  const roles = loadRoles(raw, models, { requireComplete: false });

  return {
    providers,
    providerModels,
    models,
    modelProfile: { roles },
    memory: loadMemory(raw),
    runtime: loadRuntime(raw),
    taskBudget: loadTaskBudget(raw),
    observability: loadObservability(raw),
    extensions: loadExtensions(raw),
    mcpServers: loadMcpServers(raw),
  };
};

export const listProviderConnections = (config: ScorelConfig | ScorelConfigProfile): ProviderConnectionSummary[] =>
  Object.entries(config.providers).map(([providerId, provider]) => ({
    providerId,
    type: provider.type,
    provider: provider.provider,
    ...(provider.type === "custom" ? { api: provider.api, baseUrl: provider.baseUrl } : {}),
    ...(provider.type === "builtin" && provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...("apiKeyEnv" in provider && provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    credentialSource: "credentialSource" in provider ? provider.credentialSource : "apiKey" in provider ? "direct" : "env",
    credentialStatus: "credentialStatus" in provider ? provider.credentialStatus : "available",
  }));

export type McpServerSummary = {
  serverId: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
};

export const listMcpServers = (config: ScorelConfig | ScorelConfigProfile): McpServerSummary[] =>
  Object.entries(config.mcpServers).map(([serverId, server]) => ({
    serverId,
    transport: server.transport,
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
  }));

export const listAvailableModels = (config: ScorelConfig | ScorelConfigProfile): AvailableModelSummary[] =>
  Object.entries(config.models).map(([modelId, available]) => {
    const providerModel = config.providerModels[available.model];
    if (!providerModel) {
      throw new Error(`available_models.${modelId}.model must reference a configured provider model`);
    }
    const provider = config.providers[providerModel.provider];
    if (!provider) {
      throw new Error(`provider_models.${available.model}.provider must reference a configured provider`);
    }
    return {
      modelId,
      providerModelId: available.model,
      providerId: providerModel.provider,
      provider: normalizeProviderName(provider.provider),
      id: providerModel.id,
      displayName: available.displayName ?? providerModel.displayName,
      roles: modelRoles(config, modelId),
      ...(providerModel.contextWindow !== undefined ? { contextWindow: providerModel.contextWindow } : {}),
      ...(providerModel.maxTokens !== undefined ? { maxTokens: providerModel.maxTokens } : {}),
      ...(providerModel.reasoning !== undefined ? { reasoning: providerModel.reasoning } : {}),
      ...(providerModel.compat?.supportsDeveloperRole !== undefined ? { supportsDeveloperRole: providerModel.compat.supportsDeveloperRole } : {}),
      ...(providerModel.supportsImageInput !== undefined ? { supportsImageInput: providerModel.supportsImageInput } : {}),
    };
  });

export const listProviderModels = (config: ScorelConfig | ScorelConfigProfile): ProviderModelSummary[] =>
  Object.entries(config.providerModels).map(([providerModelId, model]) => {
    const provider = config.providers[model.provider];
    if (!provider) {
      throw new Error(`provider_models.${providerModelId}.provider must reference a configured provider`);
    }
    return {
      providerModelId,
      providerId: model.provider,
      provider: normalizeProviderName(provider.provider),
      id: model.id,
      displayName: model.displayName,
      availableModelIds: Object.entries(config.models)
        .filter(([, available]) => available.model === providerModelId)
        .map(([modelId]) => modelId),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
      ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(model.compat?.supportsDeveloperRole !== undefined ? { supportsDeveloperRole: model.compat.supportsDeveloperRole } : {}),
      ...(model.supportsImageInput !== undefined ? { supportsImageInput: model.supportsImageInput } : {}),
    };
  });

export const resolveModelSelection = (
  config: ScorelConfig,
  selection?: { modelId?: string; role?: ModelRole },
): ResolvedModelSelection => {
  const role = selection?.role ?? (selection?.modelId ? undefined : "standard");
  const modelId = selection?.modelId ?? config.modelProfile.roles[role ?? "standard"];
  const model = config.models[modelId];
  if (!model) {
    throw new Error(`Unknown configured model: ${modelId}`);
  }
  const providerModel = config.providerModels[model.model];
  if (!providerModel) {
    throw new Error(`available_models.${modelId}.model must reference a configured provider model`);
  }
  const provider = config.providers[providerModel.provider];
  if (!provider) {
    throw new Error(`provider_models.${model.model}.provider must reference a configured provider`);
  }
  const displayName = model.displayName ?? providerModel.displayName;
  if (provider.type === "builtin") {
    return {
      modelId,
      role,
      displayName,
      providerId: providerModel.provider,
      config: {
        ...provider,
        id: providerModel.id,
        displayName,
      },
    };
  }
  return {
    modelId,
    role,
    displayName,
    providerId: providerModel.provider,
    config: {
      ...provider,
      id: providerModel.id,
      displayName,
      ...(providerModel.contextWindow !== undefined ? { contextWindow: providerModel.contextWindow } : {}),
      ...(providerModel.maxTokens !== undefined ? { maxTokens: providerModel.maxTokens } : {}),
      ...(providerModel.reasoning !== undefined ? { reasoning: providerModel.reasoning } : {}),
      ...(providerModel.supportsImageInput !== undefined ? { supportsImageInput: providerModel.supportsImageInput } : {}),
      ...(providerModel.compat ? { compat: providerModel.compat } : {}),
    },
  };
};

export const renderModelProfileConfig = (input: UpsertModelProfileConfigInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);

  if (input.removeProviderId) {
    removeProvider(raw, requireIdentifier(input.removeProviderId, "removeProviderId"));
  }

  if (input.providerType || input.provider || input.apiKeyEnv || input.apiKey || input.api || input.baseUrl) {
    const providerId = requireIdentifier(input.providerId, "providerId");
    const providerType = requireProviderType(input.providerType, "providerType");
    const existingProvider = raw.providers[providerId];
    raw.providers[providerId] = {
      type: providerType,
      provider: normalizeProviderName(requireString(input.provider, "provider")),
    };
    if (input.apiKey !== undefined) {
      raw.providers[providerId].apiKey = input.apiKey ? requireString(input.apiKey, "apiKey") : existingProvider?.apiKey;
    } else if (existingProvider?.apiKey) {
      raw.providers[providerId].apiKey = existingProvider.apiKey;
    }
    if (input.apiKeyEnv !== undefined) {
      raw.providers[providerId].apiKeyEnv = input.apiKeyEnv ? requireString(input.apiKeyEnv, "apiKeyEnv") : existingProvider?.apiKeyEnv;
    } else if (existingProvider?.apiKeyEnv) {
      raw.providers[providerId].apiKeyEnv = existingProvider.apiKeyEnv;
    }
    requireProviderCredential(raw.providers[providerId], `providers.${providerId}`);
    if (providerType === "custom") {
      raw.providers[providerId].api = requireCustomApi(input.api, "api");
      raw.providers[providerId].baseUrl = stripTrailingSlashes(requireString(input.baseUrl, "baseUrl"));
    } else {
      delete raw.providers[providerId].api;
      if (input.baseUrl) {
        raw.providers[providerId].baseUrl = stripTrailingSlashes(input.baseUrl);
      } else {
        delete raw.providers[providerId].baseUrl;
      }
    }
  }

  if (input.providerModelKey || input.providerModelId || input.displayName || input.contextWindow !== undefined || input.maxTokens !== undefined || input.reasoning !== undefined || input.supportsDeveloperRole !== undefined || input.supportsImageInput !== undefined) {
    const providerId = requireIdentifier(input.providerId, "providerId");
    const providerModelKey = requireIdentifier(input.providerModelKey ?? `${providerId}_${input.availableModelId ?? input.modelId ?? "main"}`, "providerModelKey");
    const providerType = raw.providers[providerId]?.type ?? input.providerType;
    raw.providerModels[providerModelKey] = {
      provider: providerId,
      id: requireString(input.providerModelId, "providerModelId"),
      displayName: requireString(input.displayName, "displayName"),
    };
    if (providerType === "custom" && input.contextWindow !== undefined) {
      raw.providerModels[providerModelKey].contextWindow = requireNumber(input.contextWindow, "contextWindow");
    }
    if (providerType === "custom" && input.maxTokens !== undefined) {
      raw.providerModels[providerModelKey].maxTokens = requireNumber(input.maxTokens, "maxTokens");
    }
    if (providerType === "custom" && input.reasoning !== undefined) {
      raw.providerModels[providerModelKey].reasoning = requireBoolean(input.reasoning, "reasoning");
    }
    if (providerType === "custom" && input.supportsImageInput !== undefined) {
      raw.providerModels[providerModelKey].supportsImageInput = requireBoolean(input.supportsImageInput, "supportsImageInput");
    }
    if (providerType === "custom" && input.supportsDeveloperRole !== undefined) {
      raw.providerModels[providerModelKey].supportsDeveloperRole = requireBoolean(input.supportsDeveloperRole, "supportsDeveloperRole");
    }
    if (providerType !== "custom") {
      delete raw.providerModels[providerModelKey].contextWindow;
      delete raw.providerModels[providerModelKey].maxTokens;
      delete raw.providerModels[providerModelKey].reasoning;
      delete raw.providerModels[providerModelKey].supportsDeveloperRole;
      delete raw.providerModels[providerModelKey].supportsImageInput;
    }
  }

  if (input.addToAvailable === true || input.availableModelId || input.modelId) {
    const providerId = input.providerId ? requireIdentifier(input.providerId, "providerId") : undefined;
    const providerModelKey = requireIdentifier(input.providerModelKey ?? (providerId ? `${providerId}_${input.availableModelId ?? input.modelId ?? "main"}` : undefined), "providerModelKey");
    const availableModelId = requireIdentifier(input.availableModelId ?? input.modelId, "availableModelId");
    raw.availableModels[availableModelId] = {
      model: providerModelKey,
      ...(input.displayName ? { displayName: input.displayName } : {}),
    };
  }

  if (input.removeAvailableModelId) {
    const availableModelId = requireIdentifier(input.removeAvailableModelId, "removeAvailableModelId");
    delete raw.availableModels[availableModelId];
    if (raw.modelProfile?.roles) {
      const fallbackModelId = Object.keys(raw.availableModels).sort()[0];
      if (!fallbackModelId) {
        delete raw.modelProfile;
      } else {
        for (const role of ["primary", "standard", "auxiliary"] as const) {
          if (raw.modelProfile.roles[role] === availableModelId) {
            raw.modelProfile.roles[role] = fallbackModelId;
          }
        }
      }
    }
  }

  if (input.roles) {
    raw.modelProfile ??= {};
    raw.modelProfile.roles = {
      primary: requireIdentifier(input.roles.primary, "roles.primary"),
      standard: requireIdentifier(input.roles.standard, "roles.standard"),
      auxiliary: requireIdentifier(input.roles.auxiliary, "roles.auxiliary"),
    };
  } else if (!raw.modelProfile?.roles && Object.keys(raw.availableModels).length > 0) {
    const firstAvailableModel = Object.keys(raw.availableModels).sort()[0]!;
    raw.modelProfile = {
      roles: {
        primary: firstAvailableModel,
        standard: firstAvailableModel,
        auxiliary: firstAvailableModel,
      },
    };
  }

  return renderRawConfig(raw);
};

const removeProvider = (raw: RawConfig, providerId: string): void => {
  delete raw.providers[providerId];
  const removedProviderModels = new Set<string>();
  for (const [providerModelId, providerModel] of Object.entries(raw.providerModels)) {
    if (providerModel.provider === providerId) {
      delete raw.providerModels[providerModelId];
      removedProviderModels.add(providerModelId);
    }
  }
  const removedAvailableModels = new Set<string>();
  for (const [availableModelId, availableModel] of Object.entries(raw.availableModels)) {
    if (availableModel.model && removedProviderModels.has(availableModel.model)) {
      delete raw.availableModels[availableModelId];
      removedAvailableModels.add(availableModelId);
    }
  }
  if (!raw.modelProfile?.roles) return;
  const fallbackModelId = Object.keys(raw.availableModels).sort()[0];
  if (!fallbackModelId) {
    delete raw.modelProfile;
    return;
  }
  for (const role of ["primary", "standard", "auxiliary"] as const) {
    if (!raw.modelProfile.roles[role] || removedAvailableModels.has(raw.modelProfile.roles[role])) {
      raw.modelProfile.roles[role] = fallbackModelId;
    }
  }
};

export const renderMemoryConfig = (input: UpsertMemoryConfigInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  raw.memory = {
    ...loadMemory(raw),
    ...(input.enabled !== undefined ? { enabled: requireBoolean(input.enabled, "memory.enabled") } : {}),
    ...(input.daily !== undefined ? { daily: requireBoolean(input.daily, "memory.daily") } : {}),
    ...(input.sessionMemory !== undefined ? { sessionMemory: requireBoolean(input.sessionMemory, "memory.sessionMemory") } : {}),
    ...(input.autoDream !== undefined ? { autoDream: requireBoolean(input.autoDream, "memory.autoDream") } : {}),
    ...(input.promoteRoot !== undefined ? { promoteRoot: requireBoolean(input.promoteRoot, "memory.promoteRoot") } : {}),
    ...(input.dreamIdleMinutes !== undefined ? { dreamIdleMinutes: requireNonNegativeNumber(input.dreamIdleMinutes, "memory.dreamIdleMinutes") } : {}),
    ...(input.autoCompactThreshold !== undefined ? { autoCompactThreshold: requireCompactThreshold(input.autoCompactThreshold) } : {}),
  };
  return renderRawConfig(raw);
};

export const renderRuntimeConfig = (input: UpsertRuntimeConfigInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  raw.runtime = {
    ...loadRuntime(raw),
    ...(input.tokenSavingRtk !== undefined ? { tokenSavingRtk: requireBoolean(input.tokenSavingRtk, "runtime.tokenSavingRtk") } : {}),
  };
  return renderRawConfig(raw);
};

export const renderTaskBudgetConfig = (input: UpsertTaskBudgetConfigInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  raw.taskBudget = {
    ...loadTaskBudget(raw),
    ...(input.maxTokens !== undefined ? { maxTokens: requireNonNegativeNumber(input.maxTokens, "taskBudget.maxTokens") } : {}),
    ...(input.maxCostUsd !== undefined ? { maxCostUsd: requireNonNegativeNumber(input.maxCostUsd, "taskBudget.maxCostUsd") } : {}),
    ...(input.maxWallClockMinutes !== undefined ? { maxWallClockMinutes: requireNonNegativeNumber(input.maxWallClockMinutes, "taskBudget.maxWallClockMinutes") } : {}),
    ...(input.repeatedCommandThreshold !== undefined ? { repeatedCommandThreshold: requireNonNegativeNumber(input.repeatedCommandThreshold, "taskBudget.repeatedCommandThreshold") } : {}),
    ...(input.staleProgressMinutes !== undefined ? { staleProgressMinutes: requireNonNegativeNumber(input.staleProgressMinutes, "taskBudget.staleProgressMinutes") } : {}),
  };
  return renderRawConfig(raw);
};

export const renderObservabilityConfig = (input: UpsertObservabilityConfigInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  const current = loadObservability(raw);
  raw.observability = {
    local: input.local !== undefined ? requireBoolean(input.local, "observability.local") : current.local,
  };
  raw.observabilitySync = {
    enabled: input.sync?.enabled !== undefined
      ? requireBoolean(input.sync.enabled, "observability.sync.enabled")
      : current.sync.enabled,
    mode: input.sync?.mode !== undefined
      ? requireObservabilitySyncMode(input.sync.mode)
      : current.sync.mode,
    targets: input.sync?.targets !== undefined
      ? renderObservabilityTargets(input.sync.targets)
      : current.sync.targets.join(","),
  };
  raw.observabilityLangfuse = {
    enabled: input.langfuse?.enabled !== undefined
      ? requireBoolean(input.langfuse.enabled, "observability.langfuse.enabled")
      : current.langfuse.enabled,
    ...observabilityOptionalString(input.langfuse, current.langfuse, "host"),
    ...observabilityOptionalString(input.langfuse, current.langfuse, "publicKey"),
    ...observabilityOptionalString(input.langfuse, current.langfuse, "secretKey"),
  };
  raw.observabilityOtel = {
    enabled: input.otel?.enabled !== undefined
      ? requireBoolean(input.otel.enabled, "observability.otel.enabled")
      : current.otel.enabled,
    ...observabilityOptionalString(input.otel, current.otel, "endpoint"),
    protocol: input.otel?.protocol !== undefined
      ? requireObservabilityOtelProtocol(input.otel.protocol)
      : current.otel.protocol,
  };
  return renderRawConfig(raw);
};

const hasOwn = <T extends object, K extends PropertyKey>(value: T | undefined, key: K): boolean =>
  value !== undefined && Object.prototype.hasOwnProperty.call(value, key);

const observabilityOptionalString = <
  K extends string,
>(
  patch: Partial<Record<K, string | undefined>> | undefined,
  current: Partial<Record<K, string | undefined>>,
  key: K,
): Partial<Record<K, string>> => {
  if (hasOwn(patch, key)) {
    const value = patch?.[key]?.trim();
    return value ? { [key]: value } as Partial<Record<K, string>> : {};
  }
  const value = current[key];
  return value ? { [key]: value } as Partial<Record<K, string>> : {};
};

export const renderExtensionConfig = (input: UpsertExtensionConfigInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  const extensionId = requireIdentifier(input.extensionId, "extensionId");
  const existing = raw.extensions[extensionId] ?? {};
  const config = { ...(existing.config ?? {}) };
  for (const [key, value] of Object.entries(input.config ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`Unsupported config key: ${key}`);
    }
    if (value === undefined || value === "") {
      delete config[key];
    } else {
      config[key] = value;
    }
  }
  raw.extensions[extensionId] = {
    enabled: input.enabled ?? existing.enabled ?? false,
    kind: input.kind ?? (existing.kind === "im" ? "im" : "im"),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
  return renderRawConfig(raw);
};

export const renderMcpServerConfig = (input: UpsertMcpServerInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  const serverId = requireIdentifier(input.serverId, "serverId");
  const transport = requireMcpTransport(input.transport, "transport");
  const entry: RawConfig["mcpServers"][string] = { transport };
  if (input.command !== undefined) {
    entry.command = input.command || undefined;
  }
  if (input.args !== undefined) {
    entry.args = input.args.length > 0 ? input.args : undefined;
  }
  if (input.env !== undefined) {
    entry.env = Object.keys(input.env).length > 0 ? input.env : undefined;
  }
  if (input.cwd !== undefined) {
    entry.cwd = input.cwd || undefined;
  }
  if (input.url !== undefined) {
    entry.url = input.url ? stripTrailingSlashes(input.url) : undefined;
  }
  if (input.headers !== undefined) {
    entry.headers = Object.keys(input.headers).length > 0 ? input.headers : undefined;
  }
  if (input.envHeaders !== undefined) {
    entry.envHeaders = Object.keys(input.envHeaders).length > 0 ? input.envHeaders : undefined;
  }
  raw.mcpServers[serverId] = entry;
  return renderRawConfig(raw);
};

export const removeMcpServerConfig = (input: RemoveMcpServerInput): string => {
  const raw = parseEditableConfig(input.existingConfigText);
  const serverId = requireIdentifier(input.serverId, "serverId");
  delete raw.mcpServers[serverId];
  return renderRawConfig(raw);
};

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  daily: true,
  sessionMemory: true,
  autoDream: true,
  promoteRoot: true,
  dreamIdleMinutes: 60,
  autoCompactThreshold: 0.8,
};

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  tokenSavingRtk: false,
};

const DEFAULT_TASK_BUDGET_CONFIG: TaskBudgetConfig = {
  maxTokens: 0,
  maxCostUsd: 0,
  maxWallClockMinutes: 0,
  repeatedCommandThreshold: 3,
  staleProgressMinutes: 10,
};

const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  local: true,
  sync: {
    enabled: false,
    mode: "manual",
    targets: [],
  },
  langfuse: {
    enabled: false,
  },
  otel: {
    enabled: false,
    protocol: "otlp-http",
  },
};

const loadMemory = (raw: RawConfig): MemoryConfig => ({
  enabled: raw.memory?.enabled ?? DEFAULT_MEMORY_CONFIG.enabled,
  daily: raw.memory?.daily ?? DEFAULT_MEMORY_CONFIG.daily,
  sessionMemory: raw.memory?.sessionMemory ?? DEFAULT_MEMORY_CONFIG.sessionMemory,
  autoDream: raw.memory?.autoDream ?? DEFAULT_MEMORY_CONFIG.autoDream,
  promoteRoot: raw.memory?.promoteRoot ?? DEFAULT_MEMORY_CONFIG.promoteRoot,
  dreamIdleMinutes: requireNonNegativeNumber(raw.memory?.dreamIdleMinutes ?? DEFAULT_MEMORY_CONFIG.dreamIdleMinutes, "memory.dreamIdleMinutes"),
  autoCompactThreshold: requireCompactThreshold(raw.memory?.autoCompactThreshold ?? DEFAULT_MEMORY_CONFIG.autoCompactThreshold),
});

const loadRuntime = (raw: RawConfig): RuntimeConfig => ({
  tokenSavingRtk: raw.runtime?.tokenSavingRtk ?? DEFAULT_RUNTIME_CONFIG.tokenSavingRtk,
});

const loadTaskBudget = (raw: RawConfig): TaskBudgetConfig => ({
  maxTokens: requireNonNegativeNumber(raw.taskBudget?.maxTokens ?? DEFAULT_TASK_BUDGET_CONFIG.maxTokens, "taskBudget.maxTokens"),
  maxCostUsd: requireNonNegativeNumber(raw.taskBudget?.maxCostUsd ?? DEFAULT_TASK_BUDGET_CONFIG.maxCostUsd, "taskBudget.maxCostUsd"),
  maxWallClockMinutes: requireNonNegativeNumber(raw.taskBudget?.maxWallClockMinutes ?? DEFAULT_TASK_BUDGET_CONFIG.maxWallClockMinutes, "taskBudget.maxWallClockMinutes"),
  repeatedCommandThreshold: requireNonNegativeNumber(raw.taskBudget?.repeatedCommandThreshold ?? DEFAULT_TASK_BUDGET_CONFIG.repeatedCommandThreshold, "taskBudget.repeatedCommandThreshold"),
  staleProgressMinutes: requireNonNegativeNumber(raw.taskBudget?.staleProgressMinutes ?? DEFAULT_TASK_BUDGET_CONFIG.staleProgressMinutes, "taskBudget.staleProgressMinutes"),
});

const loadObservability = (raw: RawConfig): ObservabilityConfig => ({
  local: raw.observability?.local ?? DEFAULT_OBSERVABILITY_CONFIG.local,
  sync: {
    enabled: raw.observabilitySync?.enabled ?? DEFAULT_OBSERVABILITY_CONFIG.sync.enabled,
    mode: requireObservabilitySyncMode(raw.observabilitySync?.mode ?? DEFAULT_OBSERVABILITY_CONFIG.sync.mode),
    targets: parseObservabilityTargets(raw.observabilitySync?.targets),
  },
  langfuse: {
    enabled: raw.observabilityLangfuse?.enabled ?? DEFAULT_OBSERVABILITY_CONFIG.langfuse.enabled,
    ...(raw.observabilityLangfuse?.host ? { host: stripTrailingSlashes(raw.observabilityLangfuse.host) } : {}),
    ...(raw.observabilityLangfuse?.publicKey ? { publicKey: raw.observabilityLangfuse.publicKey } : {}),
    ...(raw.observabilityLangfuse?.secretKey ? { secretKey: raw.observabilityLangfuse.secretKey } : {}),
  },
  otel: {
    enabled: raw.observabilityOtel?.enabled ?? DEFAULT_OBSERVABILITY_CONFIG.otel.enabled,
    ...(raw.observabilityOtel?.endpoint ? { endpoint: stripTrailingSlashes(raw.observabilityOtel.endpoint) } : {}),
    protocol: requireObservabilityOtelProtocol(raw.observabilityOtel?.protocol ?? DEFAULT_OBSERVABILITY_CONFIG.otel.protocol),
  },
});

const loadExtensions = (raw: RawConfig): Record<string, ExtensionConfig> => {
  const extensions: Record<string, ExtensionConfig> = {};
  for (const [extensionId, extension] of Object.entries(raw.extensions)) {
    if (extension.kind !== "im") {
      throw new Error(`extensions.${extensionId}.kind must be im`);
    }
    extensions[extensionId] = {
      enabled: extension.enabled === true,
      kind: "im",
      config: extension.config ?? {},
    };
  }
  return extensions;
};

const loadMcpServers = (raw: RawConfig): Record<string, McpServerConfigEntry> => {
  const servers: Record<string, McpServerConfigEntry> = {};
  for (const [serverId, server] of Object.entries(raw.mcpServers)) {
    const transport = requireMcpTransport(server.transport, `mcp.servers.${serverId}.transport`);
    const entry: McpServerConfigEntry = { transport };
    if (server.command) {
      entry.command = requireString(server.command, `mcp.servers.${serverId}.command`);
    }
    if (server.args) {
      entry.args = parseStringArray(server.args, `mcp.servers.${serverId}.args`);
    }
    if (server.env) {
      entry.env = parseStringMap(server.env, `mcp.servers.${serverId}.env`);
    }
    if (server.cwd) {
      entry.cwd = requireString(server.cwd, `mcp.servers.${serverId}.cwd`);
    }
    if (server.url) {
      entry.url = stripTrailingSlashes(requireString(server.url, `mcp.servers.${serverId}.url`));
    }
    if (server.headers) {
      entry.headers = parseStringMap(server.headers, `mcp.servers.${serverId}.headers`);
    }
    if (server.envHeaders) {
      entry.envHeaders = parseStringMap(server.envHeaders, `mcp.servers.${serverId}.envHeaders`);
    }
    if (transport === "stdio" && !entry.command) {
      throw new Error(`mcp.servers.${serverId}.command is required for stdio transport`);
    }
    if ((transport === "http" || transport === "sse") && !entry.url) {
      throw new Error(`mcp.servers.${serverId}.url is required for ${transport} transport`);
    }
    servers[serverId] = entry;
  }
  return servers;
};

const requireMcpTransport = (value: string | undefined, name: string): "stdio" | "http" | "sse" => {
  if (value === "stdio" || value === "http" || value === "sse") {
    return value;
  }
  throw new Error(`${name} must be stdio, http, or sse`);
};

const parseStringArray = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${name}[${index}] must be a string`);
    }
    return item;
  });
};

const parseStringMap = (value: unknown, name: string): Record<string, string> => {
  if (!isRecord(value)) {
    throw new Error(`${name} must be a table`);
  }
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== "string") {
      throw new Error(`${name}.${key} must be a string`);
    }
    result[key] = val;
  }
  return result;
};

const loadProviders = (raw: RawConfig, env: Record<string, string | undefined>): Record<string, ScorelProviderConfig> => {
  const providers: Record<string, ScorelProviderConfig> = {};
  for (const [providerId, provider] of Object.entries(raw.providers)) {
    const apiKey = resolveProviderApiKey(provider, env, `providers.${providerId}`);

    if (provider.type === "builtin") {
      providers[providerId] = {
        type: "builtin",
        provider: normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)),
        ...(provider.baseUrl ? { baseUrl: stripTrailingSlashes(provider.baseUrl) } : {}),
        apiKey,
      };
      continue;
    }

    if (provider.type === "custom") {
      providers[providerId] = {
        type: "custom",
        api: requireCustomApi(provider.api, `providers.${providerId}.api`),
        provider: normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)),
        baseUrl: stripTrailingSlashes(requireString(provider.baseUrl, `providers.${providerId}.baseUrl`)),
        apiKey,
      };
      continue;
    }

    throw new Error(`providers.${providerId}.type must be builtin or custom`);
  }
  if (Object.keys(providers).length === 0) {
    throw new Error("at least one provider config is required");
  }
  return providers;
};

const loadProviderProfiles = (
  raw: RawConfig,
  env: Record<string, string | undefined>,
  options: { includeSecrets?: boolean } = {},
): Record<string, ProviderProfileConfig> => {
  const providers: Record<string, ProviderProfileConfig> = {};
  for (const [providerId, provider] of Object.entries(raw.providers)) {
    const credential = providerCredentialSummary(provider, env);
    const base = {
      providerId,
      provider: normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)),
      ...credential,
      ...(options.includeSecrets && provider.apiKey ? { apiKey: provider.apiKey } : {}),
    } as const;

    if (provider.type === "builtin") {
      providers[providerId] = {
        ...base,
        type: "builtin",
        ...(provider.baseUrl ? { baseUrl: stripTrailingSlashes(provider.baseUrl) } : {}),
      };
      continue;
    }

    if (provider.type === "custom") {
      providers[providerId] = {
        ...base,
        type: "custom",
        api: requireCustomApi(provider.api, `providers.${providerId}.api`),
        baseUrl: stripTrailingSlashes(requireString(provider.baseUrl, `providers.${providerId}.baseUrl`)),
      };
      continue;
    }

    throw new Error(`providers.${providerId}.type must be builtin or custom`);
  }
  return providers;
};

const loadProviderModels = (
  raw: RawConfig,
  providers: Record<string, { type: "builtin" | "custom" }>,
  options: { requireAny?: boolean } = { requireAny: true },
): Record<string, ProviderModelConfig> => {
  const models: Record<string, ProviderModelConfig> = {};
  for (const [modelId, model] of Object.entries(raw.providerModels)) {
    const providerId = requireString(model.provider, `provider_models.${modelId}.provider`);
    const provider = providers[providerId];
    if (!provider) {
      throw new Error(`provider_models.${modelId}.provider must reference a configured provider`);
    }
    const loaded: ProviderModelConfig = {
      provider: providerId,
      id: requireString(model.id, `provider_models.${modelId}.id`),
      displayName: requireString(model.displayName, `provider_models.${modelId}.displayName`),
    };
    if (provider.type === "custom") {
      if (model.contextWindow !== undefined) {
        loaded.contextWindow = requireNumber(model.contextWindow, `provider_models.${modelId}.contextWindow`);
      }
      if (model.maxTokens !== undefined) {
        loaded.maxTokens = requireNumber(model.maxTokens, `provider_models.${modelId}.maxTokens`);
      }
      if (model.reasoning !== undefined) {
        loaded.reasoning = requireBoolean(model.reasoning, `provider_models.${modelId}.reasoning`);
      }
      if (model.supportsImageInput !== undefined) {
        loaded.supportsImageInput = requireBoolean(model.supportsImageInput, `provider_models.${modelId}.supportsImageInput`);
      }
      if (model.supportsDeveloperRole !== undefined) {
        loaded.compat = {
          supportsDeveloperRole: requireBoolean(model.supportsDeveloperRole, `provider_models.${modelId}.supportsDeveloperRole`),
        };
      }
    }
    models[modelId] = loaded;
  }
  if (options.requireAny !== false && Object.keys(models).length === 0) {
    throw new Error("at least one provider model config is required");
  }
  return models;
};

const loadAvailableModels = (
  raw: RawConfig,
  providerModels: Record<string, ProviderModelConfig>,
  options: { requireAny?: boolean; includeAllProviderModels?: boolean } = { requireAny: true, includeAllProviderModels: true },
): Record<string, AvailableModelConfig> => {
  const models: Record<string, AvailableModelConfig> = {};
  if (options.includeAllProviderModels !== false && Object.keys(raw.availableModels).length === 0) {
    for (const [modelId, providerModel] of Object.entries(providerModels)) {
      models[modelId] = {
        model: modelId,
        displayName: providerModel.displayName,
      };
    }
    return models;
  }
  for (const [modelId, model] of Object.entries(raw.availableModels)) {
    const providerModelId = requireString(model.model, `available_models.${modelId}.model`);
    if (!providerModels[providerModelId]) {
      throw new Error(`available_models.${modelId}.model must reference a configured provider model`);
    }
    models[modelId] = {
      model: providerModelId,
      ...(model.displayName ? { displayName: model.displayName } : {}),
    };
  }
  if (options.requireAny !== false && Object.keys(models).length === 0) {
    throw new Error("at least one available model config is required");
  }
  return models;
};

const loadRoles = (
  raw: RawConfig,
  models: Record<string, AvailableModelConfig>,
  options: { requireComplete?: boolean } = { requireComplete: true },
): Record<ModelRole, string> => {
  const roles = raw.modelProfile?.roles;
  if (!roles) {
    if (options.requireComplete === false) {
      return { primary: "", standard: "", auxiliary: "" };
    }
    throw new Error("model_profile.roles is required");
  }
  if (options.requireComplete === false) {
    return {
      primary: roles.primary && models[roles.primary] ? roles.primary : "",
      standard: roles.standard && models[roles.standard] ? roles.standard : "",
      auxiliary: roles.auxiliary && models[roles.auxiliary] ? roles.auxiliary : "",
    };
  }
  return {
    primary: requireModelRole(roles.primary, "primary", models),
    standard: requireModelRole(roles.standard, "standard", models),
    auxiliary: requireModelRole(roles.auxiliary, "auxiliary", models),
  };
};

const readConfigText = async (options: LoadScorelConfigOptions): Promise<string> => {
  const userPath = configPathForDevice(options);
  try {
    return await readFile(userPath, "utf8");
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT")) {
      throw new Error(`Scorel config not found: ${userPath}`);
    }
    throw cause;
  }
};

const configPathForDevice = (options: LoadScorelConfigOptions): string => {
  if (options.scorelHomeDir) {
    return join(options.scorelHomeDir, "config.toml");
  }
  const home = options.homeDir ?? process.env.HOME;
  if (!home) {
    throw new Error("Scorel config not found: HOME is not set");
  }
  return scorelUserConfigPath(home);
};

const parseToml = (text: string): RawConfig => {
  const result: RawConfig = emptyRawConfig();
  let section: ConfigSection = { kind: "root" };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (sectionMatch) {
      section = parseConfigSection(sectionMatch[1] ?? "");
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
    if (isKnownConfigKey(section, key)) {
      setConfigValue(result, section, key, parseTomlValue(rawValue));
    }
  }

  return result;
};

const parseEditableConfig = (text: string | undefined): RawConfig => {
  if (!text?.trim()) {
    return emptyRawConfig();
  }
  return parseToml(text);
};

const renderRawConfig = (raw: RawConfig): string => {
  const lines: string[] = [];
  for (const [providerId, provider] of Object.entries(raw.providers).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`[providers.${providerId}]`);
    lines.push(`type = ${tomlString(requireProviderType(provider.type, `providers.${providerId}.type`))}`);
    lines.push(`provider = ${tomlString(normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)))}`);
    if (provider.type === "custom") {
      lines.push(`api = ${tomlString(requireCustomApi(provider.api, `providers.${providerId}.api`))}`);
      lines.push(`baseUrl = ${tomlString(stripTrailingSlashes(requireString(provider.baseUrl, `providers.${providerId}.baseUrl`)))}`);
    } else if (provider.baseUrl) {
      lines.push(`baseUrl = ${tomlString(stripTrailingSlashes(provider.baseUrl))}`);
    }
    if (provider.apiKey) {
      lines.push(`apiKey = ${tomlString(requireString(provider.apiKey, `providers.${providerId}.apiKey`))}`);
    } else {
      lines.push(`apiKeyEnv = ${tomlString(requireString(provider.apiKeyEnv, `providers.${providerId}.apiKeyEnv`))}`);
    }
    lines.push("");
  }

  for (const [modelId, model] of Object.entries(raw.providerModels).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`[provider_models.${modelId}]`);
    lines.push(`provider = ${tomlString(requireString(model.provider, `provider_models.${modelId}.provider`))}`);
    lines.push(`id = ${tomlString(requireString(model.id, `provider_models.${modelId}.id`))}`);
    lines.push(`displayName = ${tomlString(requireString(model.displayName, `provider_models.${modelId}.displayName`))}`);
    const provider = raw.providers[model.provider ?? ""];
    if (provider?.type === "custom" && model.contextWindow !== undefined) {
      lines.push(`contextWindow = ${requireNumber(model.contextWindow, `provider_models.${modelId}.contextWindow`)}`);
    }
    if (provider?.type === "custom" && model.maxTokens !== undefined) {
      lines.push(`maxTokens = ${requireNumber(model.maxTokens, `provider_models.${modelId}.maxTokens`)}`);
    }
    if (provider?.type === "custom" && model.reasoning !== undefined) {
      lines.push(`reasoning = ${requireBoolean(model.reasoning, `provider_models.${modelId}.reasoning`)}`);
    }
    if (provider?.type === "custom" && model.supportsImageInput !== undefined) {
      lines.push(`supportsImageInput = ${requireBoolean(model.supportsImageInput, `provider_models.${modelId}.supportsImageInput`)}`);
    }
    if (provider?.type === "custom" && model.supportsDeveloperRole !== undefined) {
      lines.push(`supportsDeveloperRole = ${requireBoolean(model.supportsDeveloperRole, `provider_models.${modelId}.supportsDeveloperRole`)}`);
    }
    lines.push("");
  }

  for (const [modelId, model] of Object.entries(raw.availableModels).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`[available_models.${modelId}]`);
    lines.push(`model = ${tomlString(requireString(model.model, `available_models.${modelId}.model`))}`);
    if (model.displayName) {
      lines.push(`displayName = ${tomlString(model.displayName)}`);
    }
    lines.push("");
  }

  if (raw.modelProfile?.roles) {
    lines.push("[model_profile.roles]");
    lines.push(`primary = ${tomlString(requireIdentifier(raw.modelProfile.roles.primary, "model_profile.roles.primary"))}`);
    lines.push(`standard = ${tomlString(requireIdentifier(raw.modelProfile.roles.standard, "model_profile.roles.standard"))}`);
    lines.push(`auxiliary = ${tomlString(requireIdentifier(raw.modelProfile.roles.auxiliary, "model_profile.roles.auxiliary"))}`);
    lines.push("");
  }
  if (raw.memory) {
    const memory = loadMemory(raw);
    lines.push("[memory]");
    lines.push(`enabled = ${memory.enabled}`);
    lines.push(`daily = ${memory.daily}`);
    lines.push(`sessionMemory = ${memory.sessionMemory}`);
    lines.push(`autoDream = ${memory.autoDream}`);
    lines.push(`promoteRoot = ${memory.promoteRoot}`);
    lines.push(`dreamIdleMinutes = ${memory.dreamIdleMinutes}`);
    lines.push(`autoCompactThreshold = ${memory.autoCompactThreshold}`);
    lines.push("");
  }
  if (raw.runtime) {
    const runtime = loadRuntime(raw);
    lines.push("[runtime]");
    lines.push(`tokenSavingRtk = ${runtime.tokenSavingRtk}`);
    lines.push("");
  }
  if (raw.taskBudget) {
    const taskBudget = loadTaskBudget(raw);
    lines.push("[taskBudget]");
    lines.push(`maxTokens = ${taskBudget.maxTokens}`);
    lines.push(`maxCostUsd = ${taskBudget.maxCostUsd}`);
    lines.push(`maxWallClockMinutes = ${taskBudget.maxWallClockMinutes}`);
    lines.push(`repeatedCommandThreshold = ${taskBudget.repeatedCommandThreshold}`);
    lines.push(`staleProgressMinutes = ${taskBudget.staleProgressMinutes}`);
    lines.push("");
  }
  if (raw.observability) {
    const observability = loadObservability(raw);
    lines.push("[observability]");
    lines.push(`local = ${observability.local}`);
    lines.push("");
  }
  if (raw.observabilitySync) {
    const observability = loadObservability(raw);
    lines.push("[observability.sync]");
    lines.push(`enabled = ${observability.sync.enabled}`);
    lines.push(`mode = ${tomlString(observability.sync.mode)}`);
    if (observability.sync.targets.length > 0) {
      lines.push(`targets = ${tomlString(observability.sync.targets.join(","))}`);
    }
    lines.push("");
  }
  if (raw.observabilityLangfuse) {
    const observability = loadObservability(raw);
    lines.push("[observability.langfuse]");
    lines.push(`enabled = ${observability.langfuse.enabled}`);
    if (observability.langfuse.host) {
      lines.push(`host = ${tomlString(observability.langfuse.host)}`);
    }
    if (observability.langfuse.publicKey) {
      lines.push(`publicKey = ${tomlString(observability.langfuse.publicKey)}`);
    }
    if (observability.langfuse.secretKey) {
      lines.push(`secretKey = ${tomlString(observability.langfuse.secretKey)}`);
    }
    lines.push("");
  }
  if (raw.observabilityOtel) {
    const observability = loadObservability(raw);
    lines.push("[observability.otel]");
    lines.push(`enabled = ${observability.otel.enabled}`);
    if (observability.otel.endpoint) {
      lines.push(`endpoint = ${tomlString(observability.otel.endpoint)}`);
    }
    lines.push(`protocol = ${tomlString(observability.otel.protocol)}`);
    lines.push("");
  }
  for (const [extensionId, extension] of Object.entries(raw.extensions).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`[extensions.${extensionId}]`);
    lines.push(`enabled = ${extension.enabled === true}`);
    lines.push(`kind = ${tomlString(extension.kind === "im" ? "im" : requireString(extension.kind, `extensions.${extensionId}.kind`))}`);
    lines.push("");
    if (extension.config && Object.keys(extension.config).length > 0) {
      lines.push(`[extensions.${extensionId}.config]`);
      for (const [key, value] of Object.entries(extension.config).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${key} = ${renderTomlValue(value)}`);
      }
      lines.push("");
    }
  }
  for (const [serverId, server] of Object.entries(raw.mcpServers).sort(([left], [right]) => left.localeCompare(right))) {
    const loaded = loadMcpServers({ mcpServers: { [serverId]: server } } as RawConfig);
    const entry = loaded[serverId];
    if (!entry) {
      continue;
    }
    lines.push(`[mcp.servers.${serverId}]`);
    lines.push(`transport = ${tomlString(entry.transport)}`);
    if (entry.command) {
      lines.push(`command = ${tomlString(entry.command)}`);
    }
    if (entry.args && entry.args.length > 0) {
      lines.push(`args = [${entry.args.map((a) => tomlString(a)).join(", ")}]`);
    }
    if (entry.cwd) {
      lines.push(`cwd = ${tomlString(entry.cwd)}`);
    }
    if (entry.url) {
      lines.push(`url = ${tomlString(entry.url)}`);
    }
    lines.push("");
    if (entry.env && Object.keys(entry.env).length > 0) {
      lines.push(`[mcp.servers.${serverId}.env]`);
      for (const [key, value] of Object.entries(entry.env).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
      lines.push("");
    }
    if (entry.headers && Object.keys(entry.headers).length > 0) {
      lines.push(`[mcp.servers.${serverId}.headers]`);
      for (const [key, value] of Object.entries(entry.headers).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
      lines.push("");
    }
    if (entry.envHeaders && Object.keys(entry.envHeaders).length > 0) {
      lines.push(`[mcp.servers.${serverId}.envHeaders]`);
      for (const [key, value] of Object.entries(entry.envHeaders).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
};

const emptyRawConfig = (): RawConfig => ({
  providers: {},
  providerModels: {},
  availableModels: {},
  extensions: {},
  mcpServers: {},
});

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

const normalizeProviderName = (value: string): string => {
  const provider = value.split("/")[0]?.trim();
  return provider || value.trim();
};

const requireProviderCredential = (provider: { apiKeyEnv?: string; apiKey?: string }, name: string): void => {
  if (!provider.apiKeyEnv && !provider.apiKey) {
    throw new Error(`${name}.apiKeyEnv or ${name}.apiKey is required`);
  }
};

const resolveProviderApiKey = (
  provider: { apiKeyEnv?: string; apiKey?: string },
  env: Record<string, string | undefined>,
  name: string,
): string => {
  if (provider.apiKey) {
    return provider.apiKey;
  }
  const apiKeyEnv = requireString(provider.apiKeyEnv, `${name}.apiKeyEnv`);
  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${apiKeyEnv} is not set`);
  }
  return apiKey;
};

const providerCredentialSummary = (
  provider: { apiKeyEnv?: string; apiKey?: string },
  env: Record<string, string | undefined>,
): Pick<ProviderConnectionSummary, "apiKeyEnv" | "credentialSource" | "credentialStatus"> => {
  if (provider.apiKey) {
    return {
      credentialSource: "direct",
      credentialStatus: "available",
    };
  }
  const apiKeyEnv = provider.apiKeyEnv;
  if (!apiKeyEnv) {
    return {
      credentialSource: "env",
      credentialStatus: "missing",
    };
  }
  return {
    apiKeyEnv,
    credentialSource: "env",
    credentialStatus: env[apiKeyEnv] ? "available" : "missing",
  };
};

const requireNumber = (value: number | undefined, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requireNonNegativeNumber = (value: number | undefined, name: string): number => {
  const number = requireNumber(value, name);
  if (number < 0) {
    throw new Error(`${name} must be non-negative`);
  }
  return number;
};

const requireCompactThreshold = (value: number | undefined): number => {
  const number = requireNumber(value, "memory.autoCompactThreshold");
  if (number <= 0 || number >= 1) {
    throw new Error("memory.autoCompactThreshold must be greater than 0 and less than 1");
  }
  return number;
};

const requireBoolean = (value: boolean | undefined, name: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requireCustomApi = (value: string | undefined, name: string): CustomPiAiApi => {
  if (
    value === "openai-completions" ||
    value === "openai-responses" ||
    value === "google-generative-ai" ||
    value === "anthropic-messages"
  ) {
    return value;
  }
  throw new Error(`${name} must be openai-completions, openai-responses, google-generative-ai, or anthropic-messages`);
};

const requireProviderType = (value: string | undefined, name: string): "builtin" | "custom" => {
  if (value === "builtin" || value === "custom") {
    return value;
  }
  throw new Error(`${name} must be builtin or custom`);
};

const requireObservabilitySyncMode = (value: string | undefined): "manual" | "auto" => {
  if (value === "manual" || value === "auto") {
    return value;
  }
  throw new Error("observability.sync.mode must be manual or auto");
};

const requireObservabilityOtelProtocol = (value: string | undefined): "otlp-http" => {
  if (value === "otlp-http") {
    return value;
  }
  throw new Error("observability.otel.protocol must be otlp-http");
};

const parseObservabilityTargets = (value: string | undefined): ObservabilityTarget[] => {
  if (!value) {
    return [];
  }
  const targets = value.split(",").map((target) => target.trim()).filter(Boolean);
  for (const target of targets) {
    if (target !== "langfuse" && target !== "otel") {
      throw new Error("observability.sync.targets must contain only langfuse or otel");
    }
  }
  return [...new Set(targets)] as ObservabilityTarget[];
};

const renderObservabilityTargets = (targets: ObservabilityTarget[]): string => {
  for (const target of targets) {
    if (target !== "langfuse" && target !== "otel") {
      throw new Error("observability.sync.targets must contain only langfuse or otel");
    }
  }
  return [...new Set(targets)].join(",");
};

const parseConfigSection = (section: string): ConfigSection => {
  if (section === "root") {
    return { kind: "root" };
  }
  const providerMatch = /^providers\.([A-Za-z0-9_-]+)$/.exec(section);
  if (providerMatch?.[1]) {
    return { kind: "provider", id: providerMatch[1] };
  }
  const providerModelMatch = /^provider_models\.([A-Za-z0-9_-]+)$/.exec(section);
  if (providerModelMatch?.[1]) {
    return { kind: "providerModel", id: providerModelMatch[1] };
  }
  const availableModelMatch = /^available_models\.([A-Za-z0-9_-]+)$/.exec(section);
  if (availableModelMatch?.[1]) {
    return { kind: "availableModel", id: availableModelMatch[1] };
  }
  if (section === "model_profile.roles") {
    return { kind: "modelProfileRoles" };
  }
  if (section === "memory") {
    return { kind: "memory" };
  }
  if (section === "runtime") {
    return { kind: "runtime" };
  }
  if (section === "taskBudget") {
    return { kind: "taskBudget" };
  }
  if (section === "observability") {
    return { kind: "observability" };
  }
  if (section === "observability.sync") {
    return { kind: "observabilitySync" };
  }
  if (section === "observability.langfuse") {
    return { kind: "observabilityLangfuse" };
  }
  if (section === "observability.otel") {
    return { kind: "observabilityOtel" };
  }
  const extensionConfigMatch = /^extensions\.([A-Za-z0-9_-]+)\.config$/.exec(section);
  if (extensionConfigMatch?.[1]) {
    return { kind: "extensionConfig", id: extensionConfigMatch[1] };
  }
  const extensionMatch = /^extensions\.([A-Za-z0-9_-]+)$/.exec(section);
  if (extensionMatch?.[1]) {
    return { kind: "extension", id: extensionMatch[1] };
  }
  const mcpServerMatch = /^mcp\.servers\.([A-Za-z0-9_-]+)$/.exec(section);
  if (mcpServerMatch?.[1]) {
    return { kind: "mcpServer", id: mcpServerMatch[1] };
  }
  const mcpServerEnvMatch = /^mcp\.servers\.([A-Za-z0-9_-]+)\.env$/.exec(section);
  if (mcpServerEnvMatch?.[1]) {
    return { kind: "mcpServerEnv", id: mcpServerEnvMatch[1] };
  }
  const mcpServerHeadersMatch = /^mcp\.servers\.([A-Za-z0-9_-]+)\.headers$/.exec(section);
  if (mcpServerHeadersMatch?.[1]) {
    return { kind: "mcpServerHeaders", id: mcpServerHeadersMatch[1] };
  }
  const mcpServerEnvHeadersMatch = /^mcp\.servers\.([A-Za-z0-9_-]+)\.envHeaders$/.exec(section);
  if (mcpServerEnvHeadersMatch?.[1]) {
    return { kind: "mcpServerEnvHeaders", id: mcpServerEnvHeadersMatch[1] };
  }
  return { kind: "ignored" };
};

const ensureSection = (config: RawConfig, section: ConfigSection): void => {
  if (section.kind === "provider") {
    config.providers[section.id] ??= {};
  } else if (section.kind === "providerModel") {
    config.providerModels[section.id] ??= {};
  } else if (section.kind === "availableModel") {
    config.availableModels[section.id] ??= {};
  } else if (section.kind === "modelProfileRoles") {
    config.modelProfile ??= {};
    config.modelProfile.roles ??= {};
  } else if (section.kind === "memory") {
    config.memory ??= {};
  } else if (section.kind === "runtime") {
    config.runtime ??= {};
  } else if (section.kind === "taskBudget") {
    config.taskBudget ??= {};
  } else if (section.kind === "observability") {
    config.observability ??= {};
  } else if (section.kind === "observabilitySync") {
    config.observabilitySync ??= {};
  } else if (section.kind === "observabilityLangfuse") {
    config.observabilityLangfuse ??= {};
  } else if (section.kind === "observabilityOtel") {
    config.observabilityOtel ??= {};
  } else if (section.kind === "extension") {
    config.extensions[section.id] ??= {};
  } else if (section.kind === "extensionConfig") {
    config.extensions[section.id] ??= {};
    config.extensions[section.id].config ??= {};
  } else if (section.kind === "mcpServer") {
    config.mcpServers[section.id] ??= {};
  } else if (section.kind === "mcpServerEnv") {
    config.mcpServers[section.id] ??= {};
    config.mcpServers[section.id].env ??= {};
  } else if (section.kind === "mcpServerHeaders") {
    config.mcpServers[section.id] ??= {};
    config.mcpServers[section.id].headers ??= {};
  } else if (section.kind === "mcpServerEnvHeaders") {
    config.mcpServers[section.id] ??= {};
    config.mcpServers[section.id].envHeaders ??= {};
  }
};

const setConfigValue = (config: RawConfig, section: ConfigSection, key: string, value: ConfigValue): void => {
  if (!isKnownConfigKey(section, key)) {
    return;
  }
  if (section.kind === "provider") {
    config.providers[section.id] ??= {};
    setValue(config.providers[section.id], key, value);
  } else if (section.kind === "providerModel") {
    config.providerModels[section.id] ??= {};
    setValue(config.providerModels[section.id], key, value);
  } else if (section.kind === "availableModel") {
    config.availableModels[section.id] ??= {};
    setValue(config.availableModels[section.id], key, value);
  } else if (section.kind === "modelProfileRoles") {
    config.modelProfile ??= {};
    config.modelProfile.roles ??= {};
    setValue(config.modelProfile.roles, key, value);
  } else if (section.kind === "memory") {
    config.memory ??= {};
    setValue(config.memory, key, value);
  } else if (section.kind === "runtime") {
    config.runtime ??= {};
    setValue(config.runtime, key, value);
  } else if (section.kind === "taskBudget") {
    config.taskBudget ??= {};
    setValue(config.taskBudget, key, value);
  } else if (section.kind === "observability") {
    config.observability ??= {};
    setValue(config.observability, key, value);
  } else if (section.kind === "observabilitySync") {
    config.observabilitySync ??= {};
    setValue(config.observabilitySync, key, value);
  } else if (section.kind === "observabilityLangfuse") {
    config.observabilityLangfuse ??= {};
    setValue(config.observabilityLangfuse, key, value);
  } else if (section.kind === "observabilityOtel") {
    config.observabilityOtel ??= {};
    setValue(config.observabilityOtel, key, value);
  } else if (section.kind === "extension") {
    config.extensions[section.id] ??= {};
    setValue(config.extensions[section.id], key, value);
  } else if (section.kind === "extensionConfig") {
    config.extensions[section.id] ??= {};
    const extensionConfig = config.extensions[section.id].config ?? {};
    config.extensions[section.id].config = extensionConfig;
    setValue(extensionConfig, key, value);
  } else if (section.kind === "mcpServer") {
    config.mcpServers[section.id] ??= {};
    if (key === "args") {
      config.mcpServers[section.id].args = parseTomlArrayValue(value);
    } else {
      setValue(config.mcpServers[section.id], key, value);
    }
  } else if (section.kind === "mcpServerEnv") {
    config.mcpServers[section.id] ??= {};
    config.mcpServers[section.id].env ??= {};
    config.mcpServers[section.id].env![key] = String(value);
  } else if (section.kind === "mcpServerHeaders") {
    config.mcpServers[section.id] ??= {};
    config.mcpServers[section.id].headers ??= {};
    config.mcpServers[section.id].headers![key] = String(value);
  } else if (section.kind === "mcpServerEnvHeaders") {
    config.mcpServers[section.id] ??= {};
    config.mcpServers[section.id].envHeaders ??= {};
    config.mcpServers[section.id].envHeaders![key] = String(value);
  }
};

const isKnownConfigKey = (section: ConfigSection, key: string): boolean => {
  const schemaSection = section.kind;
  if (schemaSection === "ignored") {
    return false;
  }
  if (schemaSection === "extensionConfig" || schemaSection === "mcpServerEnv" || schemaSection === "mcpServerHeaders" || schemaSection === "mcpServerEnvHeaders") {
    return /^[A-Za-z0-9_-]+$/.test(key);
  }
  const allowed = SCOREL_CONFIG_SCHEMA.sections[schemaSection].keys;
  return (allowed as readonly string[]).includes(key);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const setValue = (target: object, key: string, value: ConfigValue): void => {
  (target as Record<string, ConfigValue | undefined>)[key] = value;
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
  if (value.startsWith("[") && value.endsWith("]")) {
    return parseTomlArray(value);
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }
  throw new Error(`Unsupported config value: ${value}`);
};

const parseTomlArray = (value: string): string[] => {
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  const items: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!;
    if (char === '"' && inner[i - 1] !== "\\") {
      inString = !inString;
    } else if (char === "," && !inString) {
      items.push(parseTomlStringItem(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) {
    items.push(parseTomlStringItem(current.trim()));
  }
  return items;
};

const parseTomlStringItem = (value: string): string => {
  const match = /^"([^"]*)"$/.exec(value);
  if (match) {
    return match[1] ?? "";
  }
  return value;
};

const parseTomlArrayValue = (value: ConfigValue): string[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
    return parseTomlArray(value);
  }
  throw new Error(`Expected array value, got ${typeof value}`);
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

const requireIdentifier = (value: string | undefined, name: string): string => {
  const text = requireString(value, name);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error(`${name} must contain only letters, numbers, underscores, or hyphens`);
  }
  return text;
};

const tomlString = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;

const renderTomlValue = (value: ConfigValue): string => {
  if (typeof value === "string") {
    return tomlString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => tomlString(v)).join(", ")}]`;
  }
  return String(value);
};

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

const requireModelRole = (
  value: string | undefined,
  role: ModelRole,
  models: Record<string, AvailableModelConfig>,
): string => {
  const modelId = requireString(value, `model_profile.roles.${role}`);
  if (!models[modelId]) {
    throw new Error(`model_profile.roles.${role} must reference a configured model`);
  }
  return modelId;
};

const modelRoles = (config: ScorelConfig | ScorelConfigProfile, modelId: string): ModelRole[] =>
  (["primary", "standard", "auxiliary"] as const).filter((role) => config.modelProfile.roles[role] === modelId);
