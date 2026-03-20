import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionDetail, SessionSummary, ScorelMessage } from "../../shared/types.js";
import type { SessionState } from "../../shared/constants.js";
import {
  EXPORT_VERSION,
  MANUAL_COMPACT_TOOL_RESULT_PREVIEW,
  NANOID_LENGTH,
} from "../../shared/constants.js";
import {
  createSession as dbCreateSession,
  listSessions as dbListSessions,
  getSessionDetail as dbGetSessionDetail,
  renameSession as dbRenameSession,
  archiveSession as dbArchiveSession,
  unarchiveSession as dbUnarchiveSession,
  deleteSession as dbDeleteSession,
  insertMessage as dbInsertMessage,
  getMessages as dbGetMessages,
  getNextSeq as dbGetNextSeq,
} from "../storage/db.js";
import { redactString } from "./redact.js";

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

type StoredMessageRow = {
  seq: number;
  message_json: string;
};

function formatAssistantMarkdown(message: Extract<ScorelMessage, { role: "assistant" }>): string {
  const lines: string[] = ["## Assistant", ""];
  const textParts = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text);

  if (textParts.length > 0) {
    lines.push(textParts.join("\n\n"), "");
  }

  for (const part of message.content) {
    if (part.type === "thinking") {
      lines.push(
        "<details>",
        "<summary>Thinking</summary>",
        "",
        part.thinking,
        "",
        "</details>",
        "",
      );
      continue;
    }

    if (part.type === "toolCall") {
      const jsonLines = JSON.stringify(part.arguments, null, 2)
        .split("\n")
        .map((line) => `> ${line}`);
      lines.push(
        `> **Tool Call**: ${part.name}`,
        "> ```json",
        ...jsonLines,
        "> ```",
        "",
      );
    }
  }

  return lines.join("\n").trimEnd();
}

function formatToolResultMarkdown(message: Extract<ScorelMessage, { role: "toolResult" }>): string {
  const text = message.content.map((part) => part.text).join("\n");
  const preview = text.length > MANUAL_COMPACT_TOOL_RESULT_PREVIEW
    ? `${text.slice(0, MANUAL_COMPACT_TOOL_RESULT_PREVIEW)}... (truncated)`
    : text;

  return [
    `## Tool Result: ${message.toolName}`,
    "",
    preview,
  ].join("\n");
}

function formatMessageMarkdown(message: ScorelMessage): string {
  if (message.role === "user") {
    return ["## User", "", message.content].join("\n");
  }

  if (message.role === "assistant") {
    return formatAssistantMarkdown(message);
  }

  return formatToolResultMarkdown(message);
}

function maybeRedact(content: string, redact?: boolean): string {
  return redact ? redactString(content) : content;
}

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

  private requireSessionDetail(sessionId: string): NonNullable<ReturnType<typeof dbGetSessionDetail>> {
    const detail = dbGetSessionDetail(this.db, sessionId);
    if (!detail) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return detail;
  }

  private getStoredMessages(sessionId: string): Array<{ seq: number; message: ScorelMessage }> {
    const rows = this.db
      .prepare(
        `SELECT seq, message_json
         FROM messages
         WHERE session_id = ?
         ORDER BY seq ASC`,
      )
      .all(sessionId) as StoredMessageRow[];

    return rows.map((row) => ({
      seq: row.seq,
      message: JSON.parse(row.message_json) as ScorelMessage,
    }));
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

  unarchive(sessionId: string): void {
    dbUnarchiveSession(this.db, sessionId);
  }

  delete(sessionId: string): void {
    dbDeleteSession(this.db, sessionId);
    this.runtimes.delete(sessionId);
  }

  exportJsonl(sessionId: string, opts?: { redact?: boolean }): string {
    const detail = this.requireSessionDetail(sessionId);
    const lines = [
      JSON.stringify({
        v: EXPORT_VERSION,
        type: "session",
        session: detail.summary,
      }),
      ...this.getStoredMessages(sessionId).map(({ seq, message }) => JSON.stringify({
        v: EXPORT_VERSION,
        type: "message",
        seq,
        message,
      })),
    ];

    return maybeRedact(`${lines.join("\n")}\n`, opts?.redact);
  }

  exportMarkdown(sessionId: string, opts?: { redact?: boolean }): string {
    const detail = this.requireSessionDetail(sessionId);
    const sections = this.getStoredMessages(sessionId).map(({ message }) => formatMessageMarkdown(message));
    const markdown = [
      `# Session: ${detail.summary.title ?? "Untitled"}`,
      "",
      `- Created: ${new Date(detail.summary.createdAt).toISOString()}`,
      `- Workspace: ${detail.summary.workspaceRoot}`,
      `- Provider: ${detail.summary.activeProviderId ?? "unknown"} / ${detail.summary.activeModelId ?? "unknown"}`,
      "",
      ...sections.flatMap((section) => ["---", "", section, ""]),
    ].join("\n").trimEnd();

    return maybeRedact(`${markdown}\n`, opts?.redact);
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
