import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AppConfig = {
  defaultWorkspace: string;
};

const APP_CONFIG_FILE = "app-config.json";
const DEFAULT_WORKSPACE_NAME = "Scorel";

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
  };

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const config: AppConfig = {
      defaultWorkspace: typeof parsed.defaultWorkspace === "string" && parsed.defaultWorkspace.trim().length > 0
        ? parsed.defaultWorkspace
        : fallbackConfig.defaultWorkspace,
    };
    ensureDir(config.defaultWorkspace);
    return config;
  } catch {
    ensureDir(fallbackConfig.defaultWorkspace);
    fs.writeFileSync(configPath, JSON.stringify(fallbackConfig, null, 2), "utf8");
    return fallbackConfig;
  }
}

function ensureDir(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}
