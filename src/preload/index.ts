import { contextBridge, ipcRenderer } from "electron";

// Type-safe bridge — matches ScorelBridge from V0_SPEC (M1 subset)
const scorelBridge = {
  sessions: {
    create: (opts: { providerId: string; modelId: string; workspaceRoot: string }) =>
      ipcRenderer.invoke("sessions:create", opts),
    list: (opts?: { archived?: boolean }) =>
      ipcRenderer.invoke("sessions:list", opts),
    get: (sessionId: string) =>
      ipcRenderer.invoke("sessions:get", sessionId),
    rename: (sessionId: string, title: string) =>
      ipcRenderer.invoke("sessions:rename", sessionId, title),
    archive: (sessionId: string) =>
      ipcRenderer.invoke("sessions:archive", sessionId),
    delete: (sessionId: string) =>
      ipcRenderer.invoke("sessions:delete", sessionId),
  },
  chat: {
    send: (sessionId: string, text: string) =>
      ipcRenderer.invoke("chat:send", sessionId, text),
    abort: (sessionId: string) =>
      ipcRenderer.invoke("chat:abort", sessionId),
    onEvent: (sessionId: string, callback: (event: unknown) => void) => {
      const channel = `chat:event:${sessionId}`;
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    upsert: (config: unknown) => ipcRenderer.invoke("providers:upsert", config),
    delete: (providerId: string) =>
      ipcRenderer.invoke("providers:delete", providerId),
    testConnection: (providerId: string) =>
      ipcRenderer.invoke("providers:testConnection", providerId),
  },
  secrets: {
    store: (providerId: string, secret: string) =>
      ipcRenderer.invoke("secrets:store", providerId, secret),
    has: (providerId: string) => ipcRenderer.invoke("secrets:has", providerId),
    clear: (providerId: string) =>
      ipcRenderer.invoke("secrets:clear", providerId),
  },
};

contextBridge.exposeInMainWorld("scorel", scorelBridge);
