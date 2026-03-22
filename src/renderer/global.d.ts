import type {
  ManualCompactResult,
  McpServerConfig,
  McpServerSummary,
  PermissionConfig,
  ProviderConfig,
  SessionSummary,
  SessionDetail,
  SearchResult,
  TodoItem,
  WorkspaceEntry,
} from "@shared/types";
import type { AssistantMessageEvent, ScorelEvent } from "@shared/events";

type ScorelBridge = {
  app: {
    selectDirectory(): Promise<string | null>;
    getVersion(): Promise<string>;
    getTheme(): Promise<string>;
    getDefaultWorkspace(): Promise<string>;
    onThemeChanged(callback: (theme: string) => void): () => void;
  };
  sessions: {
    create(opts: {
      providerId: string;
      modelId: string;
      workspaceRoot: string;
    }): Promise<{ sessionId: string }>;
    updateWorkspace(sessionId: string, workspaceRoot: string): Promise<void>;
    list(opts?: { archived?: boolean }): Promise<SessionSummary[]>;
    get(sessionId: string): Promise<SessionDetail | null>;
    rename(sessionId: string, title: string): Promise<void>;
    archive(sessionId: string): Promise<void>;
    unarchive(sessionId: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
    exportJsonl(sessionId: string, opts?: { redact?: boolean }): Promise<string>;
    exportMarkdown(sessionId: string, opts?: { redact?: boolean }): Promise<string>;
  };
  search: {
    query(
      query: string,
      opts?: { sessionId?: string; limit?: number },
    ): Promise<SearchResult[]>;
  };
  compact: {
    manual(sessionId: string): Promise<ManualCompactResult>;
  };
  chat: {
    send(sessionId: string, text: string): Promise<void>;
    abort(sessionId: string): Promise<void>;
    onEvent(
      sessionId: string,
      callback: (event: AssistantMessageEvent | ScorelEvent) => void,
    ): () => void;
  };
  providers: {
    list(): Promise<ProviderConfig[]>;
    upsert(config: ProviderConfig): Promise<void>;
    delete(providerId: string): Promise<void>;
    testConnection(
      config: ProviderConfig,
      apiKey: string,
    ): Promise<{ ok: boolean; error?: string }>;
    testExisting(providerId: string): Promise<{ ok: boolean; error?: string }>;
  };
  mcp: {
    list(): Promise<McpServerSummary[]>;
    testConnection(
      config: McpServerConfig,
    ): Promise<{ ok: boolean; capabilities?: unknown; tools?: unknown[]; error?: string }>;
    save(config: McpServerConfig): Promise<McpServerSummary | null>;
    delete(serverId: string): Promise<void>;
    start(serverId: string): Promise<McpServerSummary | null>;
    stop(serverId: string): Promise<McpServerSummary | null>;
    restart(serverId: string): Promise<McpServerSummary | null>;
  };
  secrets: {
    store(providerId: string, secret: string): Promise<void>;
    has(providerId: string): Promise<boolean>;
    clear(providerId: string): Promise<void>;
  };
  workspaces: {
    list(limit?: number): Promise<WorkspaceEntry[]>;
  };
  todos: {
    list(sessionId: string): Promise<TodoItem[]>;
  };
  permissions: {
    getGlobal(): Promise<PermissionConfig>;
    setGlobal(config: PermissionConfig): Promise<PermissionConfig>;
    getSession(sessionId: string): Promise<PermissionConfig | null>;
    setSession(sessionId: string, config: PermissionConfig | null): Promise<PermissionConfig | null>;
  };
  tools: {
    approve(sessionId: string, toolCallId: string): Promise<void>;
    deny(sessionId: string, toolCallId: string): Promise<void>;
  };
  menu: {
    onNewSession(callback: () => void): () => void;
    onSettings(callback: () => void): () => void;
  };
};

declare global {
  interface Window {
    scorel: ScorelBridge;
  }
}

export {};
