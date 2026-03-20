import { ipcMain, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import type { ProviderConfig } from "../shared/types.js";
import { upsertProvider, listProviders, deleteProvider, searchMessages } from "./storage/db.js";
import { storeSecret, hasSecret, clearSecret, getSecret } from "./security/keychain.js";
import type { SessionManager } from "./core/session-manager.js";
import type { Orchestrator } from "./core/orchestrator.js";
import type { EventBus } from "./core/event-bus.js";
import type { ProviderEntry } from "./core/orchestrator.js";
import { openaiAdapter } from "./provider/openai-adapter.js";
import { anthropicAdapter } from "./provider/anthropic-adapter.js";

export function registerIpcHandlers(opts: {
  db: Database.Database;
  sessionManager: SessionManager;
  orchestrator: Orchestrator;
  eventBus: EventBus;
  providerMap: Map<string, ProviderEntry>;
  getMainWindow: () => BrowserWindow | null;
}): void {
  const { db, sessionManager, orchestrator, eventBus, providerMap, getMainWindow } = opts;

  // --- Sessions ---

  ipcMain.handle(
    "sessions:create",
    async (_event, createOpts: { providerId: string; modelId: string; workspaceRoot: string }) => {
      const sessionId = sessionManager.create(createOpts.workspaceRoot, {
        providerId: createOpts.providerId,
        modelId: createOpts.modelId,
      });
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
    async (_event, providerId: string) => {
      try {
        const apiKey = await getSecret(providerId);
        if (!apiKey) return { ok: false, error: "No API key configured" };
        return { ok: true };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

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
