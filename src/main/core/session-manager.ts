import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionDetail, SessionSummary, ScorelMessage } from "../../shared/types.js";
import type { SessionState } from "../../shared/constants.js";
import { NANOID_LENGTH } from "../../shared/constants.js";
import {
  createSession as dbCreateSession,
  listSessions as dbListSessions,
  getSessionDetail as dbGetSessionDetail,
  renameSession as dbRenameSession,
  archiveSession as dbArchiveSession,
  deleteSession as dbDeleteSession,
  insertMessage as dbInsertMessage,
  getMessages as dbGetMessages,
  getNextSeq as dbGetNextSeq,
} from "../storage/db.js";

// ---------------------------------------------------------------------------
// ID generation (CJS-safe alternative to nanoid v5 ESM)
// ---------------------------------------------------------------------------
function generateId(): string {
  return crypto.randomBytes(16).toString("base64url").slice(0, NANOID_LENGTH);
}

// ---------------------------------------------------------------------------
// In-memory per-session state
// ---------------------------------------------------------------------------
type SessionRuntime = {
  state: SessionState;
  abortController: AbortController | null;
};

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------
export class SessionManager {
  private readonly db: Database.Database;
  private readonly runtimes = new Map<string, SessionRuntime>();

  constructor(db: Database.Database) {
    this.db = db;
  }

  // --- helpers ---

  private getOrCreateRuntime(sessionId: string): SessionRuntime {
    let rt = this.runtimes.get(sessionId);
    if (!rt) {
      rt = { state: "idle", abortController: null };
      this.runtimes.set(sessionId, rt);
    }
    return rt;
  }

  // --- CRUD ---

  create(workspaceRoot: string, opts?: { providerId?: string; modelId?: string }): string {
    const id = generateId();
    dbCreateSession(this.db, {
      id,
      workspaceRoot,
      providerId: opts?.providerId,
      modelId: opts?.modelId,
    });
    this.runtimes.set(id, { state: "idle", abortController: null });
    return id;
  }

  get(sessionId: string): SessionDetail | null {
    const detail = dbGetSessionDetail(this.db, sessionId);
    if (!detail) return null;
    const messages = dbGetMessages(this.db, sessionId);
    return {
      ...detail.summary,
      activeCompactId: detail.activeCompactId,
      pinnedSystemPrompt: detail.pinnedSystemPrompt,
      settings: detail.settings,
      messages,
    };
  }

  list(opts?: { archived?: boolean }): SessionSummary[] {
    return dbListSessions(this.db, opts);
  }

  rename(sessionId: string, title: string): void {
    dbRenameSession(this.db, sessionId, title);
  }

  archive(sessionId: string): void {
    dbArchiveSession(this.db, sessionId);
    this.runtimes.delete(sessionId);
  }

  delete(sessionId: string): void {
    dbDeleteSession(this.db, sessionId);
    this.runtimes.delete(sessionId);
  }

  // --- Messages ---

  appendMessage(sessionId: string, message: ScorelMessage): number {
    const seq = dbGetNextSeq(this.db, sessionId);
    dbInsertMessage(this.db, sessionId, seq, message);
    return seq;
  }

  getMessages(sessionId: string, afterSeq?: number): ScorelMessage[] {
    return dbGetMessages(this.db, sessionId, afterSeq);
  }

  // --- State ---

  getState(sessionId: string): SessionState {
    return this.getOrCreateRuntime(sessionId).state;
  }

  setState(sessionId: string, state: SessionState): void {
    this.getOrCreateRuntime(sessionId).state = state;
  }

  // --- AbortController ---

  setAbortController(sessionId: string, controller: AbortController): void {
    this.getOrCreateRuntime(sessionId).abortController = controller;
  }

  getAbortController(sessionId: string): AbortController | null {
    return this.getOrCreateRuntime(sessionId).abortController;
  }

  clearAbortController(sessionId: string): void {
    this.getOrCreateRuntime(sessionId).abortController = null;
  }
}
