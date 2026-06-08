import { contextBridge, ipcRenderer } from "electron";

import { guiIpcChannels, type GuiApi } from "./shared/ipc.js";

const api: GuiApi = {
  getHostStatus: () => ipcRenderer.invoke(guiIpcChannels.getHostStatus),
  listLocalProjects: () => ipcRenderer.invoke(guiIpcChannels.listLocalProjects),
};

contextBridge.exposeInMainWorld("scorel", api);
