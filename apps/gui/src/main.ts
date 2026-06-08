import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

import { createGuiStore, type GuiRelayDevice, type GuiStore, type GuiVisibleRemoteProject } from "./main/gui-store.js";
import { createGuiLocalHostService, type GuiLocalHostService } from "./main/local-host.js";
import { createGuiRelayService, type GuiRelayService } from "./main/relay-service.js";
import {
  guiIpcChannels,
  type GuiHostStatus,
  type GuiProjectRef,
  type GuiRemoteProjectView,
  type GuiSnapshot,
} from "./shared/ipc.js";

const here = __dirname;

let localHost: GuiLocalHostService | null = null;
let guiStore: GuiStore;
let relayService: GuiRelayService;
let hostStatus: GuiHostStatus = { state: "starting" };
let stoppingLocalHost = false;

const guiStateDir = (): string => join(homedir(), ".scorel", "gui");
const guiStorePath = (): string => join(guiStateDir(), "gui-store.json");

const startLocalHost = async (): Promise<void> => {
  guiStore = createGuiStore(guiStorePath());
  relayService = createGuiRelayService(guiStore);
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
  ipcMain.handle(guiIpcChannels.getSnapshot, async () => guiSnapshot());
  ipcMain.handle(guiIpcChannels.listLocalProjects, async () => {
    if (hostStatus.state !== "connected") return [];
    return localHost?.listLocalProjects() ?? [];
  });
  ipcMain.handle(guiIpcChannels.addLocalProject, async () => {
    const host = requireConnectedLocalHost();
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Add local Project",
    });
    const [workDir] = result.filePaths;
    if (result.canceled || !workDir) return null;
    return host.registerLocalProject(workDir);
  });
  ipcMain.handle(guiIpcChannels.createRelayPairSession, async (_event, relayUrl?: string) =>
    relayService.createPairSession(relayUrl),
  );
  ipcMain.handle(guiIpcChannels.refreshRelayDevices, async (_event, relayUrl?: string) =>
    (await relayService.refreshAuthorizedDevices(relayUrl)).map(toRelayDeviceView),
  );
  ipcMain.handle(guiIpcChannels.listRemoteDirectories, async (_event, deviceId: string, path?: string) =>
    relayService.listRemoteDirectories(deviceId, path),
  );
  ipcMain.handle(guiIpcChannels.addRemoteProject, async (_event, deviceId: string, workDir: string) =>
    toRemoteProjectView(await relayService.registerRemoteProject(deviceId, workDir)),
  );
  ipcMain.handle(guiIpcChannels.hideRemoteProject, async (_event, deviceId: string, projectId: string) =>
    guiStore.hideVisibleRemoteProject(deviceId as never, projectId as never),
  );
  ipcMain.handle(guiIpcChannels.listSessions, async (_event, project: GuiProjectRef) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().listLocalSessions(ref.projectId)
      : relayService.listRemoteSessions(requireRelayDeviceId(ref), ref.projectId);
  });
  ipcMain.handle(guiIpcChannels.createSession, async (_event, project: GuiProjectRef) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().createLocalSession(ref.projectId)
      : relayService.createRemoteSession(requireRelayDeviceId(ref), ref.projectId);
  });
  ipcMain.handle(guiIpcChannels.openSession, async (_event, project: GuiProjectRef, sessionId: string) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().openLocalSession(sessionId)
      : relayService.openRemoteSession(requireRelayDeviceId(ref), sessionId);
  });
  ipcMain.handle(guiIpcChannels.sendMessage, async (_event, project: GuiProjectRef, sessionId: string, content: string) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().sendLocalMessage(sessionId, content)
      : relayService.sendRemoteMessage(requireRelayDeviceId(ref), sessionId, content);
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
    relayService?.close();
    await host?.stop();
  } finally {
    stoppingLocalHost = false;
  }
};

const requireConnectedLocalHost = (): GuiLocalHostService => {
  if (hostStatus.state !== "connected" || !localHost) {
    throw new Error(hostStatus.message ?? "Scorel local Host is not connected");
  }
  return localHost;
};

const guiSnapshot = async (): Promise<GuiSnapshot> => {
  const localProjects = (hostStatus.state === "connected" ? await localHost?.listLocalProjects() : []) ?? [];
  const snapshot = await guiStore.load();
  const relayDevices = snapshot.relayDevices.map(toRelayDeviceView);
  const remoteProjects = snapshot.visibleRemoteProjects.map(toRemoteProjectView);
  return {
    localProjects: localProjects.map((project) => ({ ...project, source: "local" })),
    relayDevices,
    remoteProjects,
    projects: [
      ...localProjects.map((project) => ({ ...project, source: "local" as const })),
      ...remoteProjects,
    ],
  };
};

const toRelayDeviceView = (device: GuiRelayDevice) => ({
  deviceId: device.deviceId,
  label: device.label,
  relayUrl: device.relayUrl,
  online: device.online,
  updatedAt: device.updatedAt,
});

const toRemoteProjectView = (project: GuiVisibleRemoteProject): GuiRemoteProjectView => ({
  source: "relay",
  deviceId: project.deviceId,
  projectId: project.projectId,
  displayName: project.displayName,
  workDir: project.workDir,
  relayUrl: project.relayUrl,
});

const normalizeProjectRef = (input: GuiProjectRef): GuiProjectRef => {
  if (!input || (input.source !== "local" && input.source !== "relay") || typeof input.projectId !== "string") {
    throw new Error("Invalid Project reference");
  }
  if (input.source === "relay" && typeof input.deviceId !== "string") {
    throw new Error("Relay Project reference requires a Device");
  }
  return input;
};

const requireRelayDeviceId = (input: GuiProjectRef): string => {
  if (input.source !== "relay" || !input.deviceId) {
    throw new Error("Relay Device is required");
  }
  return input.deviceId;
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
