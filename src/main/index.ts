import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { initDatabase, listProviders } from "./storage/db.js";
import { SessionManager } from "./core/session-manager.js";
import { Orchestrator } from "./core/orchestrator.js";
import type { ProviderEntry } from "./core/orchestrator.js";
import { EventBus } from "./core/event-bus.js";
import { openaiAdapter } from "./provider/openai-adapter.js";
import { getSecret } from "./security/keychain.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import type { ProviderConfig } from "../shared/types.js";
import { DB_FILENAME } from "../shared/constants.js";

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, DB_FILENAME);
  const db = initDatabase(dbPath);

  const sessionManager = new SessionManager(db);
  const eventBus = new EventBus();

  // Mutable provider map — IPC handlers update it on upsert/delete
  const providerMap = buildProviderMap(listProviders(db));

  const orchestrator = new Orchestrator({
    sessionManager,
    eventBus,
    providers: providerMap,
  });

  registerIpcHandlers({
    db,
    sessionManager,
    orchestrator,
    eventBus,
    providerMap,
    getMainWindow,
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

function buildProviderMap(
  configs: ProviderConfig[],
): Map<string, ProviderEntry> {
  const map = new Map<string, ProviderEntry>();
  for (const config of configs) {
    if (config.api === "openai-chat-completions") {
      map.set(config.id, {
        config,
        adapter: openaiAdapter,
        getApiKey: () => getSecret(config.id),
      });
    }
    // Anthropic adapter: M1.5
  }
  return map;
}
