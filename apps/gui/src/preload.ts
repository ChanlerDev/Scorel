import { contextBridge, ipcRenderer } from "electron";

import { guiIpcChannels, type GuiApi } from "./shared/ipc.js";

const api: GuiApi = {
  getHostStatus: () => ipcRenderer.invoke(guiIpcChannels.getHostStatus),
  listLocalProjects: () => ipcRenderer.invoke(guiIpcChannels.listLocalProjects),
  addLocalProject: () => ipcRenderer.invoke(guiIpcChannels.addLocalProject),
  listLocalSessions: (projectId) => ipcRenderer.invoke(guiIpcChannels.listLocalSessions, projectId),
  createLocalSession: (projectId) => ipcRenderer.invoke(guiIpcChannels.createLocalSession, projectId),
  openLocalSession: (sessionId) => ipcRenderer.invoke(guiIpcChannels.openLocalSession, sessionId),
  sendLocalMessage: (sessionId, content) => ipcRenderer.invoke(guiIpcChannels.sendLocalMessage, sessionId, content),
};

contextBridge.exposeInMainWorld("scorel", api);
