import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EmbeddingConfig, PermissionConfig } from "../shared/types.js";

export type AppConfig = {
  defaultWorkspace: string;
  permissions: PermissionConfig;
  embedding: EmbeddingConfig;
  mcp: {
    healthCheckIntervalMs: number;
    maxHealthFailures: number;
  };
};

const APP_CONFIG_FILE = "app-config.json";
const DEFAULT_WORKSPACE_NAME = "Scorel";

const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  fullAccess: false,
  toolDefaults: {},
  denyReasons: {},
};

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: true,
  providerId: null,
  model: "text-embedding-3-small",
  dimensions: 1536,
};

const DEFAULT_MCP_CONFIG: AppConfig["mcp"] = {
  healthCheckIntervalMs: 30_000,
  maxHealthFailures: 3,
};

export function getDefaultWorkspacePath(homeDir = os.homedir()): string {
  return path.join(homeDir, DEFAULT_WORKSPACE_NAME);
}

export function loadAppConfig(
  userDataPath: string,
  opts?: { homeDir?: string },
): AppConfig {
  const configPath = path.join(userDataPath, APP_CONFIG_FILE);
  const fallbackConfig: AppConfig = {
    defaultWorkspace: getDefaultWorkspacePath(opts?.homeDir),
    permissions: DEFAULT_PERMISSION_CONFIG,
    embedding: DEFAULT_EMBEDDING_CONFIG,
    mcp: DEFAULT_MCP_CONFIG,
  };

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const config: AppConfig = {
      defaultWorkspace: typeof parsed.defaultWorkspace === "string" && parsed.defaultWorkspace.trim().length > 0
        ? parsed.defaultWorkspace
        : fallbackConfig.defaultWorkspace,
      permissions: normalizePermissionConfig(parsed.permissions),
      embedding: normalizeEmbeddingConfig(parsed.embedding),
      mcp: normalizeMcpConfig(parsed.mcp),
    };
    ensureDir(config.defaultWorkspace);
    return config;
  } catch {
    ensureDir(fallbackConfig.defaultWorkspace);
    fs.writeFileSync(configPath, JSON.stringify(fallbackConfig, null, 2), "utf8");
    return fallbackConfig;
  }
}

function normalizeMcpConfig(value: unknown): AppConfig["mcp"] {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_MCP_CONFIG };
  }

  const candidate = value as Partial<AppConfig["mcp"]>;
  return {
    healthCheckIntervalMs: typeof candidate.healthCheckIntervalMs === "number" && candidate.healthCheckIntervalMs >= 5_000
      ? candidate.healthCheckIntervalMs
      : DEFAULT_MCP_CONFIG.healthCheckIntervalMs,
    maxHealthFailures: typeof candidate.maxHealthFailures === "number" && candidate.maxHealthFailures >= 1
      ? candidate.maxHealthFailures
      : DEFAULT_MCP_CONFIG.maxHealthFailures,
  };
}

export function saveAppConfig(userDataPath: string, config: AppConfig): void {
  const configPath = path.join(userDataPath, APP_CONFIG_FILE);
  ensureDir(config.defaultWorkspace);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function normalizePermissionConfig(value: unknown): PermissionConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_PERMISSION_CONFIG };
  }

  const candidate = value as Partial<PermissionConfig>;
  return {
    fullAccess: candidate.fullAccess === true,
    toolDefaults: candidate.toolDefaults && typeof candidate.toolDefaults === "object"
      ? Object.fromEntries(
        Object.entries(candidate.toolDefaults).filter(([toolName, level]) =>
          typeof toolName === "string"
          && toolName.trim().length > 0
          && (level === "allow" || level === "confirm" || level === "deny")
        ),
      )
      : {},
    denyReasons: candidate.denyReasons && typeof candidate.denyReasons === "object"
      ? Object.fromEntries(
        Object.entries(candidate.denyReasons).filter(([toolName, reason]) =>
          typeof toolName === "string"
          && toolName.trim().length > 0
          && typeof reason === "string"
        ),
      )
      : {},
  };
}

export function normalizeEmbeddingConfig(value: unknown): EmbeddingConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_EMBEDDING_CONFIG };
  }

  const candidate = value as Partial<EmbeddingConfig>;
  return {
    enabled: candidate.enabled !== false,
    providerId: typeof candidate.providerId === "string" && candidate.providerId.trim().length > 0
      ? candidate.providerId.trim()
      : null,
    model: typeof candidate.model === "string" && candidate.model.trim().length > 0
      ? candidate.model.trim()
      : DEFAULT_EMBEDDING_CONFIG.model,
    dimensions: typeof candidate.dimensions === "number" && Number.isInteger(candidate.dimensions) && candidate.dimensions > 0
      ? candidate.dimensions
      : DEFAULT_EMBEDDING_CONFIG.dimensions,
  };
}

function ensureDir(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}
