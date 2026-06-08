import { contextBridge, ipcRenderer } from "electron";

import { guiIpcChannels, type GuiApi } from "./shared/ipc.js";

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
  createSession: (project) => ipcRenderer.invoke(guiIpcChannels.createSession, project),
  openSession: (project, sessionId) => ipcRenderer.invoke(guiIpcChannels.openSession, project, sessionId),
  sendMessage: (project, sessionId, content) => ipcRenderer.invoke(guiIpcChannels.sendMessage, project, sessionId, content),
};

contextBridge.exposeInMainWorld("scorel", api);
