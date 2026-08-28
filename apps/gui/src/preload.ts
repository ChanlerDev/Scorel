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
  renameRelayDevice: (deviceId, label) => ipcRenderer.invoke(guiIpcChannels.renameRelayDevice, deviceId, label),
  listSessions: (project) => ipcRenderer.invoke(guiIpcChannels.listSessions, project),
  listModels: (device) => ipcRenderer.invoke(guiIpcChannels.listModels, device),
  upsertModelProfile: (device, input) => ipcRenderer.invoke(guiIpcChannels.upsertModelProfile, device, input),
  removeModelProvider: (device, providerId) => ipcRenderer.invoke(guiIpcChannels.removeModelProvider, device, providerId),
  fetchProviderModels: (device, providerId) => ipcRenderer.invoke(guiIpcChannels.fetchProviderModels, device, providerId),
  getMemorySettings: (device) => ipcRenderer.invoke(guiIpcChannels.getMemorySettings, device),
  getMemoryStatus: (project) => ipcRenderer.invoke(guiIpcChannels.getMemoryStatus, project),
  upsertMemorySettings: (device, input) => ipcRenderer.invoke(guiIpcChannels.upsertMemorySettings, device, input),
  getRuntimeSettings: (device) => ipcRenderer.invoke(guiIpcChannels.getRuntimeSettings, device),
  upsertRuntimeSettings: (device, input) => ipcRenderer.invoke(guiIpcChannels.upsertRuntimeSettings, device, input),
  getTaskBudgetSettings: (device) => ipcRenderer.invoke(guiIpcChannels.getTaskBudgetSettings, device),
  upsertTaskBudgetSettings: (device, input) => ipcRenderer.invoke(guiIpcChannels.upsertTaskBudgetSettings, device, input),
  getObservabilitySettings: (device) => ipcRenderer.invoke(guiIpcChannels.getObservabilitySettings, device),
  upsertObservabilitySettings: (device, input) => ipcRenderer.invoke(guiIpcChannels.upsertObservabilitySettings, device, input),
  getExtensionSettings: (extensionId) => ipcRenderer.invoke(guiIpcChannels.getExtensionSettings, extensionId),
  upsertExtensionSettings: (input) => ipcRenderer.invoke(guiIpcChannels.upsertExtensionSettings, input),
  listMcpServers: () => ipcRenderer.invoke(guiIpcChannels.listMcpServers),
  upsertMcpServer: (input) => ipcRenderer.invoke(guiIpcChannels.upsertMcpServer, input),
  removeMcpServer: (input) => ipcRenderer.invoke(guiIpcChannels.removeMcpServer, input),
  callMcpTool: (input) => ipcRenderer.invoke(guiIpcChannels.callMcpTool, input),
  listCloudMcp: (registryUrl) => ipcRenderer.invoke(guiIpcChannels.listCloudMcp, registryUrl),
  addCloudMcp: (input) => ipcRenderer.invoke(guiIpcChannels.addCloudMcp, input),
  createSession: (project, modelSelection) => ipcRenderer.invoke(guiIpcChannels.createSession, project, modelSelection),
  openSession: (project, sessionId) => ipcRenderer.invoke(guiIpcChannels.openSession, project, sessionId),
  attachSession: (project, sessionId) => ipcRenderer.invoke(guiIpcChannels.attachSession, project, sessionId),
  detachSession: (sessionId) => ipcRenderer.invoke(guiIpcChannels.detachSession, sessionId),
  sendMessage: (project, sessionId, content, modelSelection) =>
    ipcRenderer.invoke(guiIpcChannels.sendMessage, project, sessionId, content, modelSelection),
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
