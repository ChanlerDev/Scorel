import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { guiIpcChannels, type GuiApi, type GuiSessionEventPayload, type GuiSessionsChangedPayload } from "./shared/ipc.js";

const api: GuiApi = {
  getHostStatus: () => ipcRenderer.invoke(guiIpcChannels.getHostStatus),
  getSnapshot: () => ipcRenderer.invoke(guiIpcChannels.getSnapshot),
  listLocalProjects: () => ipcRenderer.invoke(guiIpcChannels.listLocalProjects),
  addLocalProject: () => ipcRenderer.invoke(guiIpcChannels.addLocalProject),
  createRelayPairSession: (relayUrl) => ipcRenderer.invoke(guiIpcChannels.createRelayPairSession, relayUrl),
  refreshRelayDevices: (relayUrl) => ipcRenderer.invoke(guiIpcChannels.refreshRelayDevices, relayUrl),
  listRemoteDirectories: (deviceId, path) => ipcRenderer.invoke(guiIpcChannels.listRemoteDirectories, deviceId, path),
  addRemoteProject: (deviceId, workDir) => ipcRenderer.invoke(guiIpcChannels.addRemoteProject, deviceId, workDir),
  hideRemoteProject: (deviceId, projectId) => ipcRenderer.invoke(guiIpcChannels.hideRemoteProject, deviceId, projectId),
  listSessions: (project) => ipcRenderer.invoke(guiIpcChannels.listSessions, project),
  listModels: (project) => ipcRenderer.invoke(guiIpcChannels.listModels, project),
  upsertModelProfile: (project, input) => ipcRenderer.invoke(guiIpcChannels.upsertModelProfile, project, input),
  removeModelProvider: (project, providerId) => ipcRenderer.invoke(guiIpcChannels.removeModelProvider, project, providerId),
  fetchProviderModels: (project, providerId) => ipcRenderer.invoke(guiIpcChannels.fetchProviderModels, project, providerId),
  getMemorySettings: (project) => ipcRenderer.invoke(guiIpcChannels.getMemorySettings, project),
  getMemoryStatus: (project) => ipcRenderer.invoke(guiIpcChannels.getMemoryStatus, project),
  upsertMemorySettings: (project, input) => ipcRenderer.invoke(guiIpcChannels.upsertMemorySettings, project, input),
  getExtensionSettings: (extensionId) => ipcRenderer.invoke(guiIpcChannels.getExtensionSettings, extensionId),
  upsertExtensionSettings: (input) => ipcRenderer.invoke(guiIpcChannels.upsertExtensionSettings, input),
  createSession: (project, modelSelection) => ipcRenderer.invoke(guiIpcChannels.createSession, project, modelSelection),
  openSession: (project, sessionId) => ipcRenderer.invoke(guiIpcChannels.openSession, project, sessionId),
  attachSession: (project, sessionId) => ipcRenderer.invoke(guiIpcChannels.attachSession, project, sessionId),
  detachSession: (sessionId) => ipcRenderer.invoke(guiIpcChannels.detachSession, sessionId),
  sendMessage: (project, sessionId, content) => ipcRenderer.invoke(guiIpcChannels.sendMessage, project, sessionId, content),
  onSessionEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: GuiSessionEventPayload): void => {
      handler(payload);
    };
    ipcRenderer.on(guiIpcChannels.sessionEvent, listener);
    return () => {
      ipcRenderer.off(guiIpcChannels.sessionEvent, listener);
    };
  },
  onSessionsChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: GuiSessionsChangedPayload): void => {
      handler(payload);
    };
    ipcRenderer.on(guiIpcChannels.sessionsChanged, listener);
    return () => {
      ipcRenderer.off(guiIpcChannels.sessionsChanged, listener);
    };
  },
  onOpenSettings: (handler) => {
    const listener = (): void => {
      handler();
    };
    ipcRenderer.on(guiIpcChannels.openSettings, listener);
    return () => {
      ipcRenderer.off(guiIpcChannels.openSettings, listener);
    };
  },
};

contextBridge.exposeInMainWorld("scorel", api);
