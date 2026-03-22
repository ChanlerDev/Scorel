import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PermissionConfig, ToolName } from "../shared/types.js";

export type AppConfig = {
  defaultWorkspace: string;
  permissions: PermissionConfig;
};

const APP_CONFIG_FILE = "app-config.json";
const DEFAULT_WORKSPACE_NAME = "Scorel";

const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  fullAccess: false,
  toolDefaults: {},
  denyReasons: {},
};

const VALID_PERMISSION_TOOLS = new Set<ToolName>([
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "load_skill",
  "subagent",
  "todo_write",
]);

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
  };

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const config: AppConfig = {
      defaultWorkspace: typeof parsed.defaultWorkspace === "string" && parsed.defaultWorkspace.trim().length > 0
        ? parsed.defaultWorkspace
        : fallbackConfig.defaultWorkspace,
      permissions: normalizePermissionConfig(parsed.permissions),
    };
    ensureDir(config.defaultWorkspace);
    return config;
  } catch {
    ensureDir(fallbackConfig.defaultWorkspace);
    fs.writeFileSync(configPath, JSON.stringify(fallbackConfig, null, 2), "utf8");
    return fallbackConfig;
  }
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
          VALID_PERMISSION_TOOLS.has(toolName as ToolName)
          && (level === "allow" || level === "confirm" || level === "deny")
        ),
      ) as PermissionConfig["toolDefaults"]
      : {},
    denyReasons: candidate.denyReasons && typeof candidate.denyReasons === "object"
      ? Object.fromEntries(
        Object.entries(candidate.denyReasons).filter(([toolName, reason]) =>
          VALID_PERMISSION_TOOLS.has(toolName as ToolName) && typeof reason === "string"
        ),
      ) as PermissionConfig["denyReasons"]
      : {},
  };
}

function ensureDir(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}
