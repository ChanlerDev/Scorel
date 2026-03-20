import type {
  ProviderConfig,
  SessionSummary,
  SessionDetail,
  SearchResult,
} from "@shared/types";
import type { AssistantMessageEvent, ScorelEvent } from "@shared/events";

type ScorelBridge = {
  sessions: {
    create(opts: {
      providerId: string;
      modelId: string;
      workspaceRoot: string;
    }): Promise<{ sessionId: string }>;
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
      providerId: string,
    ): Promise<{ ok: boolean; error?: string }>;
  };
  secrets: {
    store(providerId: string, secret: string): Promise<void>;
    has(providerId: string): Promise<boolean>;
    clear(providerId: string): Promise<void>;
  };
};

declare global {
  interface Window {
    scorel: ScorelBridge;
  }
}

export {};
