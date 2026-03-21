import { contextBridge, ipcRenderer } from "electron";
import type { ProviderConfig } from "../shared/types.js";

// Type-safe bridge — matches ScorelBridge from V0_SPEC (M1 subset)
const scorelBridge = {
  app: {
    selectDirectory: () => ipcRenderer.invoke("app:selectDirectory"),
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getTheme: () => ipcRenderer.invoke("app:getTheme"),
    getDefaultWorkspace: () => ipcRenderer.invoke("app:getDefaultWorkspace"),
    onThemeChanged: (callback: (theme: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, theme: string) => callback(theme);
      ipcRenderer.on("theme:changed", listener);
      return () => {
        ipcRenderer.removeListener("theme:changed", listener);
      };
    },
  },
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
    unarchive: (sessionId: string) =>
      ipcRenderer.invoke("sessions:unarchive", sessionId),
    delete: (sessionId: string) =>
      ipcRenderer.invoke("sessions:delete", sessionId),
    exportJsonl: (sessionId: string, opts?: { redact?: boolean }) =>
      ipcRenderer.invoke("sessions:exportJsonl", sessionId, opts),
    exportMarkdown: (sessionId: string, opts?: { redact?: boolean }) =>
      ipcRenderer.invoke("sessions:exportMarkdown", sessionId, opts),
  },
  search: {
    query: (query: string, opts?: { sessionId?: string; limit?: number }) =>
      ipcRenderer.invoke("search:query", query, opts),
  },
  compact: {
    manual: (sessionId: string) =>
      ipcRenderer.invoke("compact:manual", sessionId),
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
    upsert: (config: ProviderConfig) => ipcRenderer.invoke("providers:upsert", config),
    delete: (providerId: string) =>
      ipcRenderer.invoke("providers:delete", providerId),
    testConnection: (config: ProviderConfig, apiKey: string) =>
      ipcRenderer.invoke("providers:testConnection", config, apiKey),
    testExisting: (providerId: string) =>
      ipcRenderer.invoke("providers:testExisting", providerId),
  },
  secrets: {
    store: (providerId: string, secret: string) =>
      ipcRenderer.invoke("secrets:store", providerId, secret),
    has: (providerId: string) => ipcRenderer.invoke("secrets:has", providerId),
    clear: (providerId: string) =>
      ipcRenderer.invoke("secrets:clear", providerId),
  },
  workspaces: {
    list: (limit?: number) => ipcRenderer.invoke("workspaces:list", limit),
  },
  tools: {
    approve: (sessionId: string, toolCallId: string) =>
      ipcRenderer.invoke("tools:approve", sessionId, toolCallId),
    deny: (sessionId: string, toolCallId: string) =>
      ipcRenderer.invoke("tools:deny", sessionId, toolCallId),
  },
  menu: {
    onNewSession: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:new-session", listener);
      return () => {
        ipcRenderer.removeListener("menu:new-session", listener);
      };
    },
    onSettings: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:settings", listener);
      return () => {
        ipcRenderer.removeListener("menu:settings", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("scorel", scorelBridge);
