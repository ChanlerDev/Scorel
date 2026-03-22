import { app, dialog, ipcMain, BrowserWindow, nativeTheme } from "electron";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import type { PermissionConfig, ProviderConfig, WorkspaceEntry } from "../shared/types.js";
import {
  upsertProvider,
  listProviders,
  deleteProvider,
  searchMessages,
  listWorkspaces,
  upsertWorkspace,
} from "./storage/db.js";
import { listTodos } from "./storage/todos.js";
import { storeSecret, hasSecret, clearSecret, getSecret } from "./security/keychain.js";
import type { SessionManager } from "./core/session-manager.js";
import type { Orchestrator } from "./core/orchestrator.js";
import type { EventBus } from "./core/event-bus.js";
import type { ProviderEntry } from "./core/orchestrator.js";
import { openaiAdapter } from "./provider/openai-adapter.js";
import { anthropicAdapter } from "./provider/anthropic-adapter.js";
import { normalizePermissionConfig, saveAppConfig, type AppConfig } from "./app-config.js";

export function registerIpcHandlers(opts: {
  db: Database.Database;
  sessionManager: SessionManager;
  orchestrator: Orchestrator;
  eventBus: EventBus;
  providerMap: Map<string, ProviderEntry>;
  getMainWindow: () => BrowserWindow | null;
  appConfig: AppConfig;
}): void {
  const {
    db,
    sessionManager,
    orchestrator,
    eventBus,
    providerMap,
    getMainWindow,
    appConfig,
  } = opts;

  ipcMain.handle("app:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Workspace Folder",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("app:getVersion", async () => app.getVersion());
  ipcMain.handle("app:getTheme", async () => (nativeTheme.shouldUseDarkColors ? "dark" : "light"));
  ipcMain.handle("app:getDefaultWorkspace", async () => appConfig.defaultWorkspace);

  // --- Sessions ---

  ipcMain.handle(
    "sessions:create",
    async (_event, createOpts: { providerId: string; modelId: string; workspaceRoot: string }) => {
      const sessionId = sessionManager.create(createOpts.workspaceRoot, {
        providerId: createOpts.providerId,
        modelId: createOpts.modelId,
      });
      upsertWorkspace(db, createOpts.workspaceRoot);
      return { sessionId };
    },
  );

  ipcMain.handle(
    "sessions:list",
    async (_event, listOpts?: { archived?: boolean }) => {
      return sessionManager.list(listOpts);
    },
  );

  ipcMain.handle("sessions:get", async (_event, sessionId: string) => {
    return sessionManager.get(sessionId);
  });

  ipcMain.handle(
    "sessions:rename",
    async (_event, sessionId: string, title: string) => {
      sessionManager.rename(sessionId, title);
    },
  );

  ipcMain.handle("sessions:archive", async (_event, sessionId: string) => {
    sessionManager.archive(sessionId);
  });

  ipcMain.handle("sessions:unarchive", async (_event, sessionId: string) => {
    sessionManager.unarchive(sessionId);
  });

  ipcMain.handle("sessions:delete", async (_event, sessionId: string) => {
    sessionManager.delete(sessionId);
  });

  ipcMain.handle(
    "sessions:exportJsonl",
    async (_event, sessionId: string, exportOpts?: { redact?: boolean }) => {
      return sessionManager.exportJsonl(sessionId, exportOpts);
    },
  );

  ipcMain.handle(
    "sessions:exportMarkdown",
    async (_event, sessionId: string, exportOpts?: { redact?: boolean }) => {
      return sessionManager.exportMarkdown(sessionId, exportOpts);
    },
  );

  ipcMain.handle(
    "search:query",
    async (_event, query: string, searchOpts?: { sessionId?: string; limit?: number }) => {
      return searchMessages(db, query, searchOpts);
    },
  );

  // --- Chat ---

  ipcMain.handle(
    "chat:send",
    async (_event, sessionId: string, text: string) => {
      await orchestrator.send(sessionId, text);
    },
  );

  ipcMain.handle("chat:abort", async (_event, sessionId: string) => {
    orchestrator.abort(sessionId);
  });

  ipcMain.handle("compact:manual", async (_event, sessionId: string) => {
    return orchestrator.manualCompact(sessionId);
  });

  // Forward stream events to renderer
  eventBus.onAppEvent((event) => {
    const win = getMainWindow();
    if (!win) return;
    if (event.type === "llm.stream") {
      win.webContents.send(`chat:event:${event.sessionId}`, event.event);
    } else if ("sessionId" in event) {
      win.webContents.send(
        `chat:event:${(event as { sessionId: string }).sessionId}`,
        event,
      );
    }
  });

  // --- Providers ---

  ipcMain.handle("providers:list", async () => {
    return listProviders(db);
  });

  ipcMain.handle(
    "providers:upsert",
    async (_event, config: ProviderConfig) => {
      upsertProvider(db, config);
      rebuildProviderEntry(config, providerMap);
    },
  );

  ipcMain.handle("providers:delete", async (_event, providerId: string) => {
    deleteProvider(db, providerId);
    providerMap.delete(providerId);
  });

  ipcMain.handle(
    "providers:testConnection",
    async (_event, config: ProviderConfig, apiKey: string) => {
      try {
        const normalizedApiKey = apiKey.trim();
        if (!normalizedApiKey) {
          return { ok: false, error: "No API key configured" };
        }

        const response = await fetch(buildHealthcheckUrl(config), {
          method: "GET",
          headers: buildAuthHeaders(config, normalizedApiKey),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          return {
            ok: false,
            error: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
          };
        }

        return { ok: true };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("providers:testExisting", async (_event, providerId: string) => {
    const config = listProviders(db).find((provider) => provider.id === providerId);
    if (!config) {
      return { ok: false, error: "Provider not found" };
    }

    const apiKey = await getSecret(providerId);
    if (!apiKey) {
      return { ok: false, error: "No API key stored" };
    }

    try {
      const response = await fetch(buildHealthcheckUrl(config), {
        method: "GET",
        headers: buildAuthHeaders(config, apiKey),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          ok: false,
          error: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`,
        };
      }

      return { ok: true };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // --- Secrets (write-only from renderer) ---

  ipcMain.handle(
    "secrets:store",
    async (_event, providerId: string, secret: string) => {
      await storeSecret(providerId, secret);
    },
  );

  ipcMain.handle("secrets:has", async (_event, providerId: string) => {
    return hasSecret(providerId);
  });

  ipcMain.handle("secrets:clear", async (_event, providerId: string) => {
    await clearSecret(providerId);
  });

  ipcMain.handle("workspaces:list", async (_event, limit?: number) => {
    const workspaces = listWorkspaces(db, limit);
    return workspaces.map((workspace): WorkspaceEntry => ({
      ...workspace,
      exists: fs.existsSync(workspace.path),
    }));
  });

  ipcMain.handle("todos:list", async (_event, sessionId: string) => {
    return listTodos(db, sessionId);
  });

  ipcMain.handle("permissions:getGlobal", async () => {
    return appConfig.permissions;
  });

  ipcMain.handle("permissions:setGlobal", async (_event, config: PermissionConfig) => {
    appConfig.permissions = normalizePermissionConfig(config);
    saveAppConfig(app.getPath("userData"), appConfig);
    return appConfig.permissions;
  });

  ipcMain.handle("permissions:getSession", async (_event, sessionId: string) => {
    return sessionManager.getMeta(sessionId)?.permissionConfig ?? null;
  });

  ipcMain.handle("permissions:setSession", async (_event, sessionId: string, config: PermissionConfig | null) => {
    sessionManager.setPermissionConfig(sessionId, config ? normalizePermissionConfig(config) : null);
    return sessionManager.getMeta(sessionId)?.permissionConfig ?? null;
  });

  ipcMain.handle("tools:approve", async (_event, _sessionId: string, toolCallId: string) => {
    orchestrator.approveToolCall(toolCallId);
  });

  ipcMain.handle("tools:deny", async (_event, _sessionId: string, toolCallId: string) => {
    orchestrator.denyToolCall(toolCallId);
  });
}

function buildAuthHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...config.defaultHeaders,
  };

  if (config.api === "anthropic-messages") {
    headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
  }

  if (config.auth.type === "bearer") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers[config.auth.headerName ?? "x-api-key"] = apiKey;
  }

  return headers;
}

function buildHealthcheckUrl(config: ProviderConfig): string {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  if (config.api === "anthropic-messages") {
    return baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
  }

  return `${baseUrl}/models`;
}

function rebuildProviderEntry(
  config: ProviderConfig,
  providerMap: Map<string, ProviderEntry>,
): void {
  if (config.api === "openai-chat-completions") {
    providerMap.set(config.id, {
      config,
      adapter: openaiAdapter,
      getApiKey: () => getSecret(config.id),
    });
  } else if (config.api === "anthropic-messages") {
    providerMap.set(config.id, {
      config,
      adapter: anthropicAdapter,
      getApiKey: () => getSecret(config.id),
    });
  }
}
