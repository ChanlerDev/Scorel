import { app, BrowserWindow, Menu, nativeTheme } from "electron";
import * as path from "node:path";
import { initDatabase, listProviders } from "./storage/db.js";
import { SessionManager } from "./core/session-manager.js";
import { Orchestrator } from "./core/orchestrator.js";
import type { ProviderEntry } from "./core/orchestrator.js";
import { EventBus } from "./core/event-bus.js";
import { openaiAdapter } from "./provider/openai-adapter.js";
import { anthropicAdapter } from "./provider/anthropic-adapter.js";
import { getSecret } from "./security/keychain.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { scanSkills } from "./skills/skill-loader.js";
import { RunnerManager } from "./runner/runner-manager.js";
import { buildAppMenu } from "./menu.js";
import { loadWindowState, saveWindowState, type WindowState } from "./window-state.js";
import { loadAppConfig } from "./app-config.js";
import type { ProviderConfig } from "../shared/types.js";
import { DB_FILENAME } from "../shared/constants.js";

let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function resolveRunnerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "dist", "runner", "index.js");
  }

  return path.join(app.getAppPath(), "dist", "runner", "index.js");
}

function sendThemeToRenderer(): void {
  mainWindow?.webContents.send(
    "theme:changed",
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  );
}

function getNextWindowState(window: BrowserWindow, previousState: WindowState): WindowState {
  if (window.isMaximized()) {
    return {
      ...previousState,
      isMaximized: true,
    };
  }

  const bounds = window.getBounds();
  return {
    ...bounds,
    isMaximized: false,
  };
}

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData");
  const appConfig = loadAppConfig(userDataPath);
  const dbPath = path.join(userDataPath, DB_FILENAME);
  const db = initDatabase(dbPath);

  const sessionManager = new SessionManager(db);
  const eventBus = new EventBus();
  const skills = scanSkills(path.join(app.getAppPath(), "skills"));
  const compactTranscriptDir = path.join(userDataPath, "compact-transcripts");

  // Mutable provider map — IPC handlers update it on upsert/delete
  const providerMap = buildProviderMap(listProviders(db));

  const orchestrator = new Orchestrator({
    db,
    sessionManager,
    eventBus,
    providers: providerMap,
    createToolRunner: async (workspaceRoot: string) => new RunnerManager({
      workspaceRoot,
      runnerPath: resolveRunnerPath(),
    }),
    skills,
    compactTranscriptDir,
  });

  registerIpcHandlers({
    db,
    sessionManager,
    orchestrator,
    eventBus,
    providerMap,
    getMainWindow,
    appConfig,
  });

  let windowState = loadWindowState(userDataPath);

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  Menu.setApplicationMenu(buildAppMenu(getMainWindow));

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistWindowState = () => {
    if (!mainWindow) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      if (!mainWindow) {
        return;
      }
      windowState = getNextWindowState(mainWindow, windowState);
      saveWindowState(userDataPath, windowState);
    }, 300);
  };

  mainWindow.on("resize", persistWindowState);
  mainWindow.on("move", persistWindowState);
  mainWindow.on("maximize", persistWindowState);
  mainWindow.on("unmaximize", persistWindowState);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on("did-finish-load", () => {
    sendThemeToRenderer();
  });
  nativeTheme.on("updated", sendThemeToRenderer);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    nativeTheme.removeListener("updated", sendThemeToRenderer);
    mainWindow = null;
  });

  app.on("before-quit", (event) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    event.preventDefault();

    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    if (mainWindow) {
      windowState = getNextWindowState(mainWindow, windowState);
      saveWindowState(userDataPath, windowState);
    }

    void (async () => {
      try {
        orchestrator.abortAll();
        await orchestrator.shutdownRunner(3000);
        db.close();
      } catch (error: unknown) {
        console.error("Graceful shutdown failed", error);
      } finally {
        app.quit();
      }
    })();
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
    } else if (config.api === "anthropic-messages") {
      map.set(config.id, {
        config,
        adapter: anthropicAdapter,
        getApiKey: () => getSecret(config.id),
      });
    }
  }
  return map;
}
