import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

import { createGuiStore, type GuiRelayDevice, type GuiStore, type GuiVisibleRemoteProject } from "./main/gui-store.js";
import { createGuiLocalHostService, type GuiLocalHostService } from "./main/local-host.js";
import { createGuiRelayService, type GuiRelayService } from "./main/relay-service.js";
import {
  guiIpcChannels,
  type GuiHostStatus,
  type GuiUpsertExtensionSettingsInput,
  type GuiModelSelection,
  type GuiUpsertMemorySettingsInput,
  type GuiUpsertModelProfileInput,
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
let mainWindow: BrowserWindow | null = null;

const sessionSubscriptions = new Map<string, () => void>();

const guiStateDir = (): string => join(homedir(), ".scorel", "gui");
const guiStorePath = (): string => join(guiStateDir(), "gui-store.json");

const startLocalHost = async (): Promise<void> => {
  guiStore = createGuiStore(guiStorePath());
  relayService = createGuiRelayService(guiStore);
  localHost = createGuiLocalHostService({
    stateDir: guiStateDir(),
    scorelHomeDir: join(homedir(), ".scorel"),
    deviceId: "device_gui_local",
    deviceDisplayName: "Local",
  });
  await localHost.start();
  hostStatus = { state: "connected" };
};

const sessionSubscriptionKey = (sessionId: string): string => sessionId;

const detachSubscription = (sessionId: string): void => {
  const key = sessionSubscriptionKey(sessionId);
  const cleanup = sessionSubscriptions.get(key);
  if (cleanup) {
    cleanup();
    sessionSubscriptions.delete(key);
  }
};

const attachSubscription = async (project: GuiProjectRef, sessionId: string): Promise<unknown[]> => {
  detachSubscription(sessionId);
  const ref = normalizeProjectRef(project);
  const handler = (event: unknown): void => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(guiIpcChannels.sessionEvent, { sessionId, event });
  };
  if (ref.source === "local") {
    const { events, unsubscribe } = await requireConnectedLocalHost().attachLocalSession(sessionId, handler);
    sessionSubscriptions.set(sessionSubscriptionKey(sessionId), unsubscribe);
    return events;
  }
  const { events, unsubscribe } = await relayService.attachRemoteSession(
    requireRelayDeviceId(ref),
    sessionId,
    handler,
  );
  sessionSubscriptions.set(sessionSubscriptionKey(sessionId), unsubscribe);
  return events;
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
  ipcMain.handle(guiIpcChannels.listModels, async (_event, project: GuiProjectRef) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().listLocalModels(ref.projectId)
      : relayService.listRemoteModels(requireRelayDeviceId(ref), ref.projectId);
  });
  ipcMain.handle(guiIpcChannels.upsertModelProfile, async (_event, project: GuiProjectRef, input: GuiUpsertModelProfileInput) => {
    const ref = normalizeProjectRef(project);
    const payload = { ...input, projectId: ref.projectId as never };
    return ref.source === "local"
      ? requireConnectedLocalHost().upsertLocalModelProfile(payload)
      : relayService.upsertRemoteModelProfile(requireRelayDeviceId(ref), payload);
  });
  ipcMain.handle(guiIpcChannels.removeModelProvider, async (_event, project: GuiProjectRef, providerId: string) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().removeLocalModelProvider(ref.projectId, providerId)
      : relayService.removeRemoteModelProvider(requireRelayDeviceId(ref), ref.projectId, providerId);
  });
  ipcMain.handle(guiIpcChannels.fetchProviderModels, async (_event, project: GuiProjectRef, providerId: string) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().fetchLocalProviderModels(ref.projectId, providerId)
      : relayService.fetchRemoteProviderModels(requireRelayDeviceId(ref), ref.projectId, providerId);
  });
  ipcMain.handle(guiIpcChannels.getMemorySettings, async (_event, project: GuiProjectRef) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().getLocalMemorySettings(ref.projectId)
      : relayService.getRemoteMemorySettings(requireRelayDeviceId(ref), ref.projectId);
  });
  ipcMain.handle(guiIpcChannels.getMemoryStatus, async (_event, project: GuiProjectRef) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().getLocalMemoryStatus(ref.projectId)
      : relayService.getRemoteMemoryStatus(requireRelayDeviceId(ref), ref.projectId);
  });
  ipcMain.handle(guiIpcChannels.upsertMemorySettings, async (_event, project: GuiProjectRef, input: GuiUpsertMemorySettingsInput) => {
    const ref = normalizeProjectRef(project);
    const payload = { ...input, projectId: ref.projectId as never };
    return ref.source === "local"
      ? requireConnectedLocalHost().upsertLocalMemorySettings(payload)
      : relayService.upsertRemoteMemorySettings(requireRelayDeviceId(ref), payload);
  });
  ipcMain.handle(guiIpcChannels.getExtensionSettings, async (_event, extensionId: string) =>
    requireConnectedLocalHost().getLocalExtensionSettings(extensionId),
  );
  ipcMain.handle(guiIpcChannels.upsertExtensionSettings, async (_event, input: GuiUpsertExtensionSettingsInput) =>
    requireConnectedLocalHost().upsertLocalExtensionSettings(input),
  );
  ipcMain.handle(guiIpcChannels.createSession, async (_event, project: GuiProjectRef, modelSelection?: GuiModelSelection) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().createLocalSession(ref.projectId, modelSelection)
      : relayService.createRemoteSession(requireRelayDeviceId(ref), ref.projectId, modelSelection);
  });
  ipcMain.handle(guiIpcChannels.openSession, async (_event, project: GuiProjectRef, sessionId: string) => {
    const ref = normalizeProjectRef(project);
    return ref.source === "local"
      ? requireConnectedLocalHost().openLocalSession(sessionId)
      : relayService.openRemoteSession(requireRelayDeviceId(ref), sessionId);
  });
  ipcMain.handle(guiIpcChannels.attachSession, async (_event, project: GuiProjectRef, sessionId: string) =>
    attachSubscription(project, sessionId),
  );
  ipcMain.handle(guiIpcChannels.detachSession, async (_event, sessionId: string) => {
    detachSubscription(sessionId);
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#00000000",
    transparent: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  await win.loadFile(join(here, "index.html"));
};

const installApplicationMenu = (): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Scorel",
      submenu: [
        {
          label: "Settings...",
          accelerator: "CommandOrControl+,",
          click: () => {
            mainWindow?.webContents.send(guiIpcChannels.openSettings);
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      role: "editMenu",
    },
    {
      role: "viewMenu",
    },
    {
      role: "windowMenu",
    },
  ]));
};

registerIpc();

const stopLocalHost = async (): Promise<void> => {
  if (stoppingLocalHost) return;
  stoppingLocalHost = true;
  for (const cleanup of sessionSubscriptions.values()) {
    cleanup();
  }
  sessionSubscriptions.clear();
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
  installApplicationMenu();
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
