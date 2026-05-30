import type { ClientId, DeviceId, EventId, Seq, SessionId } from "./ids.js";
import type { ScorelMessage, StopReason, Usage } from "./messages.js";

export type SessionMeta = {
  title?: string;
  model?: string;
  deviceId?: DeviceId;
  createdAt?: number;
  updatedAt?: number;
  /**
   * Daemon-owned project slug pinned at session creation. Persisted into the
   * JSONL header so list_projects/list_sessions stay deterministic across
   * daemon restarts. Optional for back-compat with sessions written before
   * S0032 — readers fall back to `toProjectSlug(daemon.workDir)`.
   */
  projectSlug?: string;
  /**
   * Absolute workdir of the daemon that created this session. Optional and
   * additive: only used to populate `DaemonProjectSummary.workDirHint` and
   * pretty-print `displayName` (basename). Never reverse-engineered from the
   * slug — slug is lossy by design (see `projects/slug.ts`).
   */
  workDirHint?: string;
};

export type PersistentEventBase = {
  id: EventId;
  parentId: EventId | null;
  seq: Seq;
  sessionId: SessionId;
  clientId: ClientId;
  ts: number;
};

export type SessionHeaderEvent = PersistentEventBase & {
  type: "session_header";
  protocolVersion: 1;
  meta: SessionMeta;
};

export type UserMessageEvent = PersistentEventBase & {
  type: "user_message";
  message: ScorelMessage & { role: "user" };
};

export type AssistantMessageEvent = PersistentEventBase & {
  type: "assistant_message";
  message: ScorelMessage & { role: "assistant" };
};

export type ToolResultEvent = PersistentEventBase & {
  type: "tool_result";
  message: ScorelMessage & { role: "tool_result" };
};

export type PersistentEvent = SessionHeaderEvent | UserMessageEvent | AssistantMessageEvent | ToolResultEvent;

export type TransientEventBase = {
  seq: Seq;
  sessionId: SessionId;
  clientId: ClientId;
  ts: number;
};

export type TurnStartEvent = TransientEventBase & {
  type: "turn_start";
  turnIndex: number;
};

export type TurnEndEvent = TransientEventBase & {
  type: "turn_end";
  turnIndex: number;
  usage?: Usage;
  stopReason?: StopReason;
};

export type MessageStartEvent = TransientEventBase & {
  type: "message_start";
  eventId: EventId;
  parentId: EventId | null;
  role: "assistant" | "tool_result";
  model?: string;
};

export type MessageEndEvent = TransientEventBase & {
  type: "message_end";
  eventId: EventId;
  stopReason?: StopReason;
  usage?: Usage;
};

export type TextDeltaEvent = TransientEventBase & {
  type: "text_delta";
  eventId: EventId;
  delta: string;
};

export type ErrorEvent = TransientEventBase & {
  type: "error";
  code: ErrorCode;
  message: string;
  requestId?: string;
};

export type TransientEvent =
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageEndEvent
  | TextDeltaEvent
  | ErrorEvent;

export type ScorelEvent = PersistentEvent | TransientEvent;

export type ErrorCode =
  | "session_not_found"
  | "runtime_busy"
  | "invalid_request"
  | "auth_failed"
  | "protocol_mismatch"
  | "resync_failed"
  | "invalid_event_id"
  | "conflict"
  | "transport_closed"
  | "internal_error";

export type DaemonStatus = {
  running: boolean;
  model?: string;
  activeClients: ClientId[];
  sessionCount: number;
  uptimeMs: number;
};

export type SessionSummary = {
  sessionId: SessionId;
  title?: string;
  model?: string;
  updatedAt: number;
  currentSeq: Seq;
  /** Daemon-owned project slug — required so callers can group across daemons. */
  projectSlug: string;
};

/**
 * Aggregate view of a single project served by a daemon. Returned by
 * `list_projects`. Built from the union of session JSONL headers in the
 * daemon's sessions directory — see `packages/daemon/src/projects/aggregator.ts`.
 */
export type DaemonProjectSummary = {
  projectSlug: string;
  /** Human-readable name. `basename(workDirHint)` when known, else `projectSlug`. */
  displayName: string;
  /** Absolute path the daemon last saw for this slug. Lossy reverse of slug. */
  workDirHint?: string;
  sessionCount: number;
  /** Max(updatedAt, createdAt) across the project's sessions. */
  lastSeenAt: number;
};
