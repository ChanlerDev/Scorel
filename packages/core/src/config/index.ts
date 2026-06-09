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
};

type ConfigSection =
  | { kind: "root" }
  | { kind: "provider"; id: string }
  | { kind: "providerModel"; id: string }
  | { kind: "availableModel"; id: string }
  | { kind: "modelProfileRoles" };
type ConfigValue = string | number | boolean;

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
      primary: roles.primary ? requireModelRole(roles.primary, "primary", models) : "",
      standard: roles.standard ? requireModelRole(roles.standard, "standard", models) : "",
      auxiliary: roles.auxiliary ? requireModelRole(roles.auxiliary, "auxiliary", models) : "",
    };
  }
  return {
    primary: requireModelRole(roles.primary, "primary", models),
    standard: requireModelRole(roles.standard, "standard", models),
    auxiliary: requireModelRole(roles.auxiliary, "auxiliary", models),
  };
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
  const result: RawConfig = emptyRawConfig();
  let section: ConfigSection = { kind: "root" };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
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
  return lines.join("\n");
};

const emptyRawConfig = (): RawConfig => ({
  providers: {},
  providerModels: {},
  availableModels: {},
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

const requireSection = (section: string): ConfigSection => {
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
  throw new Error(`Unsupported config section: ${section}`);
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
  }
};

const setConfigValue = (config: RawConfig, section: ConfigSection, key: string, value: ConfigValue): void => {
  assertKnownKey(section, key);
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
  }
};

const assertKnownKey = (section: ConfigSection, key: string): void => {
  const schemaSection = section.kind;
  const allowed = SCOREL_CONFIG_SCHEMA.sections[schemaSection].keys;
  if (!(allowed as readonly string[]).includes(key)) {
    throw new Error(`Unsupported config key: ${key}`);
  }
};

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
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }
  throw new Error(`Unsupported config value: ${value}`);
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
