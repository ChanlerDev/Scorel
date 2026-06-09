import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { guiIpcChannels, type GuiApi, type GuiSessionEventPayload } from "./shared/ipc.js";

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
  fetchProviderModels: (project, providerId) => ipcRenderer.invoke(guiIpcChannels.fetchProviderModels, project, providerId),
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
};

contextBridge.exposeInMainWorld("scorel", api);
