import Database from "better-sqlite3";
import type {
  ProviderConfig,
  SessionSummary,
  ScorelMessage,
  ContentPart,
} from "../../shared/types.js";
import { FTS_CONTENT_MAX_CHARS } from "../../shared/constants.js";

// ---------------------------------------------------------------------------
// Schema version — bump when adding migrations
// ---------------------------------------------------------------------------
const CURRENT_USER_VERSION = 1;

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------
const SCHEMA_V1 = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  api TEXT NOT NULL DEFAULT 'openai-chat-completions',
  base_url TEXT NOT NULL,
  auth_json TEXT NOT NULL,
  default_headers_json TEXT,
  compat_json TEXT,
  models_json TEXT NOT NULL,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  workspace_root TEXT NOT NULL,
  active_provider_id TEXT,
  active_model_id TEXT,
  active_compact_id TEXT,
  pinned_system_prompt TEXT,
  settings_json TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  message_json TEXT NOT NULL,
  searchable_text TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_seq
  ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_session_ts
  ON messages(session_id, ts);

CREATE TABLE IF NOT EXISTS compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  boundary_message_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  transcript_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compactions_session
  ON compactions(session_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq
  ON events(session_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED,
  message_id UNINDEXED,
  content
);

-- Reserved for Beta: embeddings table
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  hash TEXT NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------
function runMigrations(db: Database.Database): void {
  const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;

  if (version < 1) {
    db.exec(SCHEMA_V1);
    db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
  }
  // Future migrations: if (version < 2) { ... db.pragma("user_version = 2"); }
}

// ---------------------------------------------------------------------------
// Public: initialise database
// ---------------------------------------------------------------------------
export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function now(): number {
  return Date.now();
}

function jsonOrNull(value: unknown): string | null {
  return value != null ? JSON.stringify(value) : null;
}

function parseJsonOrNull<T>(raw: string | null): T | null {
  if (raw == null) return null;
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------
export function upsertProvider(
  db: Database.Database,
  config: ProviderConfig,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO providers
       (id, display_name, api, base_url, auth_json,
        default_headers_json, compat_json, models_json, meta_json,
        created_at, updated_at)
     VALUES
       (@id, @displayName, @api, @baseUrl, @authJson,
        @defaultHeadersJson, @compatJson, @modelsJson, @metaJson,
        @ts, @ts)
     ON CONFLICT(id) DO UPDATE SET
       display_name = @displayName,
       api = @api,
       base_url = @baseUrl,
       auth_json = @authJson,
       default_headers_json = @defaultHeadersJson,
       compat_json = @compatJson,
       models_json = @modelsJson,
       meta_json = @metaJson,
       updated_at = @ts`,
  ).run({
    id: config.id,
    displayName: config.displayName,
    api: config.api,
    baseUrl: config.baseUrl,
    authJson: JSON.stringify(config.auth),
    defaultHeadersJson: jsonOrNull(config.defaultHeaders),
    compatJson: jsonOrNull(config.compat),
    modelsJson: JSON.stringify(config.models),
    metaJson: jsonOrNull(config.meta),
    ts,
  });
}

type ProviderRow = {
  id: string;
  display_name: string;
  api: string;
  base_url: string;
  auth_json: string;
  default_headers_json: string | null;
  compat_json: string | null;
  models_json: string;
  meta_json: string | null;
  created_at: number;
  updated_at: number;
};

function rowToProviderConfig(row: ProviderRow): ProviderConfig {
  return {
    id: row.id,
    displayName: row.display_name,
    api: row.api as ProviderConfig["api"],
    baseUrl: row.base_url,
    auth: JSON.parse(row.auth_json) as ProviderConfig["auth"],
    defaultHeaders: parseJsonOrNull<Record<string, string>>(
      row.default_headers_json,
    ) ?? undefined,
    compat: parseJsonOrNull<ProviderConfig["compat"]>(row.compat_json) ??
      undefined,
    models: JSON.parse(row.models_json) as ProviderConfig["models"],
    meta: parseJsonOrNull<Record<string, unknown>>(row.meta_json) ?? undefined,
  };
}

export function listProviders(db: Database.Database): ProviderConfig[] {
  const rows = db
    .prepare("SELECT * FROM providers ORDER BY display_name")
    .all() as ProviderRow[];
  return rows.map(rowToProviderConfig);
}

export function deleteProvider(
  db: Database.Database,
  providerId: string,
): void {
  db.prepare("DELETE FROM providers WHERE id = ?").run(providerId);
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------
type CreateSessionOpts = {
  id: string;
  workspaceRoot: string;
  providerId?: string;
  modelId?: string;
};

export function createSession(
  db: Database.Database,
  opts: CreateSessionOpts,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO sessions
       (id, title, created_at, updated_at, archived,
        workspace_root, active_provider_id, active_model_id)
     VALUES (@id, NULL, @ts, @ts, 0, @workspaceRoot, @providerId, @modelId)`,
  ).run({
    id: opts.id,
    ts,
    workspaceRoot: opts.workspaceRoot,
    providerId: opts.providerId ?? null,
    modelId: opts.modelId ?? null,
  });
}

type SessionRow = {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  archived: number;
  workspace_root: string;
  active_provider_id: string | null;
  active_model_id: string | null;
};

function rowToSessionSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    workspaceRoot: row.workspace_root,
    activeProviderId: row.active_provider_id,
    activeModelId: row.active_model_id,
  };
}

export function listSessions(
  db: Database.Database,
  opts?: { archived?: boolean },
): SessionSummary[] {
  const archived = opts?.archived;
  if (archived != null) {
    const rows = db
      .prepare(
        `SELECT id, title, created_at, updated_at, archived,
                workspace_root, active_provider_id, active_model_id
         FROM sessions WHERE archived = ? ORDER BY updated_at DESC`,
      )
      .all(archived ? 1 : 0) as SessionRow[];
    return rows.map(rowToSessionSummary);
  }
  const rows = db
    .prepare(
      `SELECT id, title, created_at, updated_at, archived,
              workspace_root, active_provider_id, active_model_id
       FROM sessions ORDER BY updated_at DESC`,
    )
    .all() as SessionRow[];
  return rows.map(rowToSessionSummary);
}

export function getSession(
  db: Database.Database,
  sessionId: string,
): SessionSummary | null {
  const row = db
    .prepare(
      `SELECT id, title, created_at, updated_at, archived,
              workspace_root, active_provider_id, active_model_id
       FROM sessions WHERE id = ?`,
    )
    .get(sessionId) as SessionRow | undefined;
  return row ? rowToSessionSummary(row) : null;
}

type SessionDetailRow = SessionRow & {
  active_compact_id: string | null;
  pinned_system_prompt: string | null;
  settings_json: string | null;
};

export function getSessionDetail(
  db: Database.Database,
  sessionId: string,
): {
  summary: SessionSummary;
  activeCompactId: string | null;
  pinnedSystemPrompt: string | null;
  settings: Record<string, unknown> | null;
} | null {
  const row = db
    .prepare(
      `SELECT id, title, created_at, updated_at, archived,
              workspace_root, active_provider_id, active_model_id,
              active_compact_id, pinned_system_prompt, settings_json
       FROM sessions WHERE id = ?`,
    )
    .get(sessionId) as SessionDetailRow | undefined;
  if (!row) return null;
  return {
    summary: rowToSessionSummary(row),
    activeCompactId: row.active_compact_id,
    pinnedSystemPrompt: row.pinned_system_prompt,
    settings: parseJsonOrNull<Record<string, unknown>>(row.settings_json),
  };
}

export function renameSession(
  db: Database.Database,
  sessionId: string,
  title: string,
): void {
  db.prepare(
    "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
  ).run(title, now(), sessionId);
}

export function archiveSession(
  db: Database.Database,
  sessionId: string,
): void {
  db.prepare(
    "UPDATE sessions SET archived = 1, updated_at = ? WHERE id = ?",
  ).run(now(), sessionId);
}

export function deleteSession(
  db: Database.Database,
  sessionId: string,
): void {
  const del = db.transaction(() => {
    db.prepare(
      "DELETE FROM messages_fts WHERE session_id = ?",
    ).run(sessionId);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM compactions WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
  del();
}

// ---------------------------------------------------------------------------
// Message persistence
// ---------------------------------------------------------------------------

/**
 * Extract searchable plain text from a message for FTS indexing.
 * - user: full content string
 * - assistant: joined text parts
 * - toolResult: content text parts, truncated to FTS_CONTENT_MAX_CHARS
 */
function extractSearchableText(message: ScorelMessage): string | null {
  switch (message.role) {
    case "user":
      return message.content || null;
    case "assistant": {
      const texts = message.content
        .filter((p: ContentPart) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text);
      const joined = texts.join("\n");
      return joined.length > 0 ? joined : null;
    }
    case "toolResult": {
      const parts = message.content
        .map((p) => p.text)
        .join("\n");
      if (parts.length === 0) return null;
      return parts.length > FTS_CONTENT_MAX_CHARS
        ? parts.slice(0, FTS_CONTENT_MAX_CHARS)
        : parts;
    }
    default:
      return null;
  }
}

export function insertMessage(
  db: Database.Database,
  sessionId: string,
  seq: number,
  message: ScorelMessage,
): void {
  const searchableText = extractSearchableText(message);
  const messageJson = JSON.stringify(message);

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, session_id, role, seq, ts, message_json, searchable_text)
       VALUES (@id, @sessionId, @role, @seq, @ts, @messageJson, @searchableText)`,
    ).run({
      id: message.id,
      sessionId,
      role: message.role,
      seq,
      ts: message.ts,
      messageJson,
      searchableText,
    });

    // FTS entry — only if there is searchable content
    if (searchableText) {
      db.prepare(
        `INSERT INTO messages_fts (session_id, message_id, content)
         VALUES (?, ?, ?)`,
      ).run(sessionId, message.id, searchableText);
    }

    // Touch session updated_at
    db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE id = ?",
    ).run(message.ts, sessionId);
  });
  insert();
}

type MessageRow = {
  message_json: string;
};

export function getMessages(
  db: Database.Database,
  sessionId: string,
  afterSeq?: number,
): ScorelMessage[] {
  if (afterSeq != null) {
    const rows = db
      .prepare(
        `SELECT message_json FROM messages
         WHERE session_id = ? AND seq > ?
         ORDER BY seq ASC`,
      )
      .all(sessionId, afterSeq) as MessageRow[];
    return rows.map((r) => JSON.parse(r.message_json) as ScorelMessage);
  }
  const rows = db
    .prepare(
      `SELECT message_json FROM messages
       WHERE session_id = ?
       ORDER BY seq ASC`,
    )
    .all(sessionId) as MessageRow[];
  return rows.map((r) => JSON.parse(r.message_json) as ScorelMessage);
}

export function getNextSeq(
  db: Database.Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      "SELECT MAX(seq) AS max_seq FROM messages WHERE session_id = ?",
    )
    .get(sessionId) as { max_seq: number | null } | undefined;
  return (row?.max_seq ?? 0) + 1;
}
