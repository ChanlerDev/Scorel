import type Database from "better-sqlite3";
import type { SessionMeta, AutoCompactConfig, AssistantMessage, ScorelMessage } from "../../shared/types.js";
import { AUTO_COMPACT_DEFAULT_THRESHOLD } from "../../shared/constants.js";
import type { ProviderAdapter } from "../provider/types.js";
import type { ProviderConfig, StoredSessionMessage } from "../../shared/types.js";
import { executeManualCompact } from "./compact.js";

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
};

const DEFAULT_CONTEXT_LIMIT = 128_000;

export function getModelContextLimit(modelId: string): number {
  const limit = MODEL_CONTEXT_LIMITS[modelId];
  if (limit != null) {
    return limit;
  }

  console.warn(`[auto-compact] Unknown model context limit for ${modelId}, using ${DEFAULT_CONTEXT_LIMIT}`);
  return DEFAULT_CONTEXT_LIMIT;
}

export function getAutoCompactConfig(session: SessionMeta): AutoCompactConfig {
  const settings = session.settings;
  if (settings && typeof settings === "object" && "autoCompact" in settings) {
    const ac = settings.autoCompact as Partial<AutoCompactConfig>;
    return {
      enabled: typeof ac.enabled === "boolean" ? ac.enabled : true,
      threshold: typeof ac.threshold === "number"
        && Number.isFinite(ac.threshold)
        && ac.threshold > 0
        && ac.threshold <= 1
        ? ac.threshold
        : AUTO_COMPACT_DEFAULT_THRESHOLD,
    };
  }
  return { enabled: true, threshold: AUTO_COMPACT_DEFAULT_THRESHOLD };
}

export function shouldAutoCompact(
  lastMessage: AssistantMessage,
  modelId: string,
  config: AutoCompactConfig,
): boolean {
  if (!config.enabled) return false;
  if (!lastMessage.usage) return false;

  const limit = getModelContextLimit(modelId);
  const totalTokens = lastMessage.usage.prompt_tokens + lastMessage.usage.completion_tokens;
  return totalTokens / limit >= config.threshold;
}

export type AutoCompactDeps = {
  db: Database.Database;
  adapter: ProviderAdapter;
  providerConfig: ProviderConfig;
  apiKey: string;
  providerId: string;
  modelId: string;
  transcriptDir?: string;
};

export type AutoCompactInput = {
  sessionId: string;
  messages: ScorelMessage[];
  storedMessages: StoredSessionMessage[];
};

export async function runAutoCompact(
  deps: AutoCompactDeps,
  input: AutoCompactInput,
): Promise<{
  compactionId: string;
  summaryText: string;
  boundaryMessageId: string;
  transcriptPath?: string;
}> {
  return executeManualCompact({
    sessionId: input.sessionId,
    messages: input.messages,
    db: deps.db,
    adapter: deps.adapter,
    providerConfig: deps.providerConfig,
    apiKey: deps.apiKey,
    providerId: deps.providerId,
    modelId: deps.modelId,
    transcriptDir: deps.transcriptDir,
    transcriptMessages: input.storedMessages,
  });
}
