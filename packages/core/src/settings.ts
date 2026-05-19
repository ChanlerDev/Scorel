import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenAICompatibleChatModel, getModel as defaultGetModel } from "./llm.js";
import type { Api, Model } from "./llm.js";

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
  getModel?: (provider: string, modelId: string) => Model<Api>;
  createOpenAICompatibleChatModel?: (options: { id: string; baseUrl: string; provider?: string }) => Model<Api>;
};

export function defaultScorelSettingsPath(env: ScorelEnvironment = process.env): string {
  return env.SCOREL_SETTINGS ?? join(homedir(), ".scorel", "settings.json");
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

export function resolveScorelModel(
  options: {
    env?: ScorelEnvironment;
    settings?: ScorelSettingsInput;
  },
  factories: ModelFactories = {}
): ResolvedScorelModel {
  const env = options.env ?? process.env;
  const settings = normalizeSettings(options.settings ?? {});
  const provider = env.SCOREL_PROVIDER ?? settings.model.provider;
  const modelId = env.SCOREL_MODEL ?? settings.model.id;
  const baseUrl = env.SCOREL_BASE_URL ?? settings.model.baseUrl;
  const apiKey = env.SCOREL_API_KEY ?? settings.model.apiKey ?? env.OPENAI_API_KEY;
  const makeKnownModel = factories.getModel ?? ((knownProvider, knownModelId) => defaultGetModel(knownProvider as never, knownModelId as never) as Model<Api>);
  const makeOpenAICompatible = factories.createOpenAICompatibleChatModel ?? createOpenAICompatibleChatModel;

  return {
    provider,
    modelId,
    apiKey,
    model: baseUrl
      ? makeOpenAICompatible({ provider, id: modelId, baseUrl })
      : makeKnownModel(provider, modelId)
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is ScorelSettingsInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
