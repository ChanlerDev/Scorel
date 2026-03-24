import Database from "better-sqlite3";
import type {
  EmbeddingConfig,
  ProviderConfig,
  PermissionConfig,
  SessionSummary,
  ScorelMessage,
  ContentPart,
  SearchResult,
  WorkspaceRecord,
} from "../../shared/types.js";
import { normalizePermissionConfig } from "../app-config.js";
import { deleteSessionTodos } from "./todos.js";

// ---------------------------------------------------------------------------
// Schema version — bump when adding migrations
// ---------------------------------------------------------------------------
const CURRENT_USER_VERSION = 5;

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
    db.pragma("user_version = 1");
  }

  if (version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        path TEXT PRIMARY KEY,
        label TEXT,
        last_used_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO workspaces (path, label, last_used_at, created_at)
      SELECT DISTINCT workspace_root, NULL, updated_at, created_at
      FROM sessions
      WHERE workspace_root IS NOT NULL AND workspace_root != '';
    `);
    db.pragma("user_version = 2");
  }

  if (version < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);

      ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id);
      ALTER TABLE sessions ADD COLUMN permission_config TEXT;
    `);
    db.pragma("user_version = 3");
  }

  if (version < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_start INTEGER NOT NULL DEFAULT 0,
        capabilities TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
    `);
    db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
  }

  if (version < 5) {
    db.exec(`
      ALTER TABLE embeddings ADD COLUMN source_type TEXT NOT NULL DEFAULT 'message';
      ALTER TABLE embeddings ADD COLUMN target_message_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE embeddings ADD COLUMN chunk_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE embeddings ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE embeddings ADD COLUMN dimensions INTEGER NOT NULL DEFAULT 1536;

      UPDATE embeddings
      SET target_message_id = source_id
      WHERE target_message_id = '';

      CREATE INDEX IF NOT EXISTS idx_embeddings_lookup
        ON embeddings(model, dimensions, tombstone, session_id);
      CREATE INDEX IF NOT EXISTS idx_embeddings_source
        ON embeddings(source_type, source_id, tombstone);
      CREATE INDEX IF NOT EXISTS idx_embeddings_hash
        ON embeddings(model, dimensions, hash, tombstone);
    `);
    db.pragma(`user_version = ${CURRENT_USER_VERSION}`);
  }
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
  try {
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    console.error("Failed to parse JSON from DB:", error);
    return null;
  }
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
// Workspace history
// ---------------------------------------------------------------------------

type WorkspaceRow = {
  path: string;
  label: string | null;
  last_used_at: number;
  created_at: number;
};

function rowToWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    path: row.path,
    label: row.label,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export function upsertWorkspace(
  db: Database.Database,
  workspacePath: string,
  label?: string,
): void {
  const trimmedPath = workspacePath.trim();
  if (!trimmedPath) {
    return;
  }

  const ts = now();
  const upsert = db.transaction(() => {
    db.prepare(
      `INSERT INTO workspaces (path, label, last_used_at, created_at)
       VALUES (@path, @label, @lastUsedAt, @createdAt)
       ON CONFLICT(path) DO UPDATE SET
         label = COALESCE(@label, label),
         last_used_at = @lastUsedAt`,
    ).run({
      path: trimmedPath,
      label: label?.trim() || null,
      lastUsedAt: ts,
      createdAt: ts,
    });

    db.prepare(
      `DELETE FROM workspaces
       WHERE path NOT IN (
         SELECT path FROM workspaces
         ORDER BY last_used_at DESC, created_at DESC
         LIMIT 20
       )`,
    ).run();
  });

  upsert();
}

export function listWorkspaces(
  db: Database.Database,
  limit = 20,
): WorkspaceRecord[] {
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);
  const rows = db.prepare(
    `SELECT path, label, last_used_at, created_at
     FROM workspaces
     ORDER BY last_used_at DESC, created_at DESC
     LIMIT ?`,
  ).all(normalizedLimit) as WorkspaceRow[];

  return rows.map(rowToWorkspaceRecord);
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------
type CreateSessionOpts = {
  id: string;
  workspaceRoot: string;
  providerId?: string;
  modelId?: string;
  parentSessionId?: string;
  permissionConfig?: string;
};

export function createSession(
  db: Database.Database,
  opts: CreateSessionOpts,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO sessions
       (id, title, created_at, updated_at, archived,
        workspace_root, active_provider_id, active_model_id,
        parent_session_id, permission_config)
     VALUES (@id, NULL, @ts, @ts, 0, @workspaceRoot, @providerId, @modelId,
             @parentSessionId, @permissionConfig)`,
  ).run({
    id: opts.id,
    ts,
    workspaceRoot: opts.workspaceRoot,
    providerId: opts.providerId ?? null,
    modelId: opts.modelId ?? null,
    parentSessionId: opts.parentSessionId ?? null,
    permissionConfig: opts.permissionConfig ?? null,
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
  parent_session_id: string | null;
  permission_config: string | null;
};

export function getSessionDetail(
  db: Database.Database,
  sessionId: string,
): {
  summary: SessionSummary;
  activeCompactId: string | null;
  pinnedSystemPrompt: string | null;
  settings: Record<string, unknown> | null;
  parentSessionId: string | null;
  permissionConfig: import("../../shared/types.js").PermissionConfig | null;
} | null {
  const row = db
    .prepare(
      `SELECT id, title, created_at, updated_at, archived,
              workspace_root, active_provider_id, active_model_id,
              active_compact_id, pinned_system_prompt, settings_json,
              parent_session_id, permission_config
       FROM sessions WHERE id = ?`,
    )
    .get(sessionId) as SessionDetailRow | undefined;
  if (!row) return null;
  const permissionConfig = parseJsonOrNull<PermissionConfig>(row.permission_config);
  return {
    summary: rowToSessionSummary(row),
    activeCompactId: row.active_compact_id,
    pinnedSystemPrompt: row.pinned_system_prompt,
    settings: parseJsonOrNull<Record<string, unknown>>(row.settings_json),
    parentSessionId: row.parent_session_id,
    permissionConfig: permissionConfig == null ? null : normalizePermissionConfig(permissionConfig),
  };
}

export function updateSessionPermissionConfig(
  db: Database.Database,
  sessionId: string,
  config: import("../../shared/types.js").PermissionConfig | null,
): void {
  db.prepare(
    "UPDATE sessions SET permission_config = ?, updated_at = ? WHERE id = ?",
  ).run(config ? JSON.stringify(config) : null, now(), sessionId);
}

export function updateSessionWorkspaceRoot(
  db: Database.Database,
  sessionId: string,
  workspaceRoot: string,
): void {
  db.prepare(
    "UPDATE sessions SET workspace_root = ?, updated_at = ? WHERE id = ?",
  ).run(workspaceRoot, now(), sessionId);
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

export function unarchiveSession(
  db: Database.Database,
  sessionId: string,
): void {
  db.prepare(
    "UPDATE sessions SET archived = 0, updated_at = ? WHERE id = ?",
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
    db.prepare("DELETE FROM embeddings WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM compactions WHERE session_id = ?").run(sessionId);
    deleteSessionTodos(db, sessionId);
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
 * Only user and assistant messages are indexed for search.
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

type SearchOptions = {
  sessionId?: string;
  limit?: number;
};

type SearchDeps = {
  embedding?: EmbeddingConfig;
  embedQuery?: (query: string, config: EmbeddingConfig) => Promise<Float32Array>;
  logWarning?: (message: string, error: unknown) => void;
  minScore?: number;
  rrfK?: number;
};

type SearchMessageRow = {
  message_id: string;
  session_id: string;
  session_title: string | null;
  role: ScorelMessage["role"];
  snippet: string;
  ts: number;
  seq: number;
};

type VectorSearchRow = {
  message_id: string;
  session_id: string;
  session_title: string | null;
  role: ScorelMessage["role"];
  snippet: string;
  ts: number;
  seq: number;
  vector: Buffer;
};

type RankedSearchResult = SearchResult & {
  keywordRank?: number;
  semanticRank?: number;
};

function bufferToVector(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += (a[index] ?? 0) * (b[index] ?? 0);
  }
  return dot;
}

function searchMessagesFts(
  db: Database.Database,
  query: string,
  opts?: SearchOptions,
): RankedSearchResult[] {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT
         m.id AS message_id,
         m.session_id,
         s.title AS session_title,
         m.role,
         snippet(messages_fts, 2, '<mark>', '</mark>', '...', 32) AS snippet,
         m.ts,
         m.seq
       FROM messages_fts
       JOIN messages AS m ON m.id = messages_fts.message_id
       JOIN sessions AS s ON s.id = m.session_id
       WHERE messages_fts MATCH @query
         AND m.role IN ('user', 'assistant')
         AND (@sessionId IS NULL OR m.session_id = @sessionId)
       ORDER BY bm25(messages_fts), m.ts DESC
       LIMIT @limit`,
    )
    .all({
      query,
      sessionId: opts?.sessionId ?? null,
      limit,
    }) as SearchMessageRow[];

  return rows.map((row, index) => ({
    messageId: row.message_id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    role: row.role,
    snippet: row.snippet,
    snippetSource: "fts",
    signals: ["keyword"],
    rrfScore: 0,
    ts: row.ts,
    seq: row.seq,
    keywordRank: index + 1,
  }));
}

function searchMessagesVector(
  db: Database.Database,
  queryVector: Float32Array,
  config: EmbeddingConfig,
  opts?: SearchOptions,
  minScore = 0.3,
): RankedSearchResult[] {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = db.prepare(
    `SELECT
       m.id AS message_id,
       m.session_id,
       s.title AS session_title,
       m.role,
       e.chunk_text AS snippet,
       m.ts,
       m.seq,
       e.vector
     FROM embeddings AS e
     JOIN messages AS m ON m.id = e.target_message_id
     JOIN sessions AS s ON s.id = m.session_id
     WHERE e.tombstone = 0
       AND m.role IN ('user', 'assistant')
       AND e.model = @model
       AND e.dimensions = @dimensions
       AND (@sessionId IS NULL OR e.session_id = @sessionId)`,
  ).all({
    model: config.model,
    dimensions: config.dimensions,
    sessionId: opts?.sessionId ?? null,
  }) as VectorSearchRow[];

  const bestByMessage = new Map<string, RankedSearchResult>();

  for (const row of rows) {
    const score = cosineSimilarity(queryVector, bufferToVector(row.vector));
    if (score < minScore) {
      continue;
    }

    const existing = bestByMessage.get(row.message_id);
    if (existing && (existing.similarityScore ?? -Infinity) >= score) {
      continue;
    }

    bestByMessage.set(row.message_id, {
      messageId: row.message_id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      role: row.role,
      snippet: row.snippet,
      snippetSource: "semantic",
      signals: ["semantic"],
      similarityScore: score,
      rrfScore: 0,
      ts: row.ts,
      seq: row.seq,
    });
  }

  return [...bestByMessage.values()]
    .sort((left, right) => {
      const scoreDelta = (right.similarityScore ?? 0) - (left.similarityScore ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return right.ts - left.ts;
    })
    .slice(0, limit)
    .map((result, index) => ({
      ...result,
      semanticRank: index + 1,
    }));
}

function fuseSearchResults(
  ftsResults: RankedSearchResult[],
  vectorResults: RankedSearchResult[],
  rrfK = 60,
  limit = 50,
): SearchResult[] {
  const merged = new Map<string, RankedSearchResult>();

  for (const result of ftsResults) {
    merged.set(result.messageId, { ...result });
  }

  for (const result of vectorResults) {
    const existing = merged.get(result.messageId);
    if (!existing) {
      merged.set(result.messageId, { ...result });
      continue;
    }

    merged.set(result.messageId, {
      ...existing,
      similarityScore: result.similarityScore,
      semanticRank: result.semanticRank,
      signals: existing.signals.includes("semantic")
        ? existing.signals
        : [...existing.signals, "semantic"],
    });
  }

  const ranked = [...merged.values()].map((result) => ({
    ...result,
    rrfScore: (result.keywordRank ? 1 / (rrfK + result.keywordRank) : 0)
      + (result.semanticRank ? 1 / (rrfK + result.semanticRank) : 0),
  }));

  return ranked
    .sort((left, right) => {
      const rrfDelta = right.rrfScore - left.rrfScore;
      if (rrfDelta !== 0) {
        return rrfDelta;
      }
      const semanticDelta = (right.similarityScore ?? 0) - (left.similarityScore ?? 0);
      if (semanticDelta !== 0) {
        return semanticDelta;
      }
      return right.ts - left.ts;
    })
    .slice(0, limit)
    .map(({ keywordRank: _keywordRank, semanticRank: _semanticRank, ...result }) => result);
}

export async function searchMessages(
  db: Database.Database,
  query: string,
  opts?: SearchOptions,
  deps?: SearchDeps,
): Promise<SearchResult[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const ftsResults = searchMessagesFts(db, normalizedQuery, { ...opts, limit });

  const embedding = deps?.embedding;
  if (!embedding?.enabled || !deps?.embedQuery) {
    return fuseSearchResults(ftsResults, [], deps?.rrfK, limit);
  }

  try {
    const queryVector = await deps.embedQuery(normalizedQuery, embedding);
    const vectorResults = searchMessagesVector(db, queryVector, embedding, { ...opts, limit }, deps?.minScore);
    return fuseSearchResults(ftsResults, vectorResults, deps?.rrfK, limit);
  } catch (error: unknown) {
    deps?.logWarning?.("Semantic query embedding failed", error);
    return fuseSearchResults(ftsResults, [], deps?.rrfK, limit);
  }
}

export function rebuildFts(db: Database.Database): void {
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
}
