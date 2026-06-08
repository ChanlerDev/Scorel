import { app, BrowserWindow, ipcMain } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

import { createGuiLocalHostService, type GuiLocalHostService } from "./main/local-host.js";
import { guiIpcChannels, type GuiHostStatus } from "./shared/ipc.js";

const here = __dirname;

let localHost: GuiLocalHostService | null = null;
let hostStatus: GuiHostStatus = { state: "starting" };
let stoppingLocalHost = false;

const guiStateDir = (): string => join(homedir(), ".scorel", "gui");

const startLocalHost = async (): Promise<void> => {
  localHost = createGuiLocalHostService({
    stateDir: guiStateDir(),
    deviceId: "device_gui_local",
    deviceDisplayName: "Local",
  });
  await localHost.start();
  hostStatus = { state: "connected" };
};

const registerIpc = (): void => {
  ipcMain.handle(guiIpcChannels.getHostStatus, async () => hostStatus);
  ipcMain.handle(guiIpcChannels.listLocalProjects, async () => {
    if (hostStatus.state !== "connected") return [];
    return localHost?.listLocalProjects() ?? [];
  });
};

const createWindow = async (): Promise<void> => {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: "Scorel",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(join(here, "index.html"));
};

registerIpc();

const stopLocalHost = async (): Promise<void> => {
  if (stoppingLocalHost) return;
  stoppingLocalHost = true;
  const host = localHost;
  localHost = null;
  try {
    await host?.stop();
  } finally {
    stoppingLocalHost = false;
  }
};

app.whenReady().then(async () => {
  try {
    await startLocalHost();
  } catch (cause) {
    hostStatus = {
      state: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  await createWindow();
});

app.on("window-all-closed", () => {
  void stopLocalHost().finally(() => app.quit());
});

app.on("before-quit", (event) => {
  if (!localHost) return;
  event.preventDefault();
  void stopLocalHost().finally(() => app.quit());
});
