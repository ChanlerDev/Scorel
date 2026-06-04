import type { ClientId, EventId, ProjectId, Seq, SessionId } from "./ids.js";
import type { ScorelMessage, StopReason, Usage } from "./messages.js";

export type CreateSessionMeta = {
  projectId: ProjectId;
  title?: string;
  model?: string;
};

export type SessionMeta = {
  projectId: ProjectId;
  title?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
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
  protocolVersion: 2;
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

export type InstructionSectionKind = "baseline" | "agents" | "memory" | "workspace" | "environment" | "time";

export type InstructionSource = {
  sourceType: "builtin" | "agents_md" | "memory";
  path?: string;
  scope?: "global_user" | "project";
  priority?: number;
  content?: string;
};

export type InstructionSection = {
  kind: InstructionSectionKind;
  frozenAt: number;
  sources?: InstructionSource[];
  renderedBlock: string;
  data?: Record<string, unknown>;
};

export type InstructionSnapshot = {
  version: 1;
  cwd: string;
  sections: InstructionSection[];
};

export type InstructionSnapshotEvent = PersistentEventBase & {
  type: "instruction_snapshot";
  snapshot: InstructionSnapshot;
};

export type HarnessItemKind =
  | "attachment"
  | "skill_listing"
  | "skill_delta"
  | "memory"
  | "date_change"
  | "steer"
  | "runtime_notice";

export type HarnessItemOrigin = "user" | "system" | "tool" | "skill";

export type HarnessItem = {
  kind: HarnessItemKind;
  origin: HarnessItemOrigin;
  content: string;
  visibility: "display" | "hidden" | "compact";
  data?: Record<string, unknown>;
};

export type HarnessItemEvent = PersistentEventBase & {
  type: "harness_item";
  item: HarnessItem;
};

export type QueueName = "follow_up" | "steer";

export type QueueItem = {
  id: string;
  content: ScorelMessage["content"];
  createdAt: number;
  updatedAt: number;
  clientId: ClientId;
  data?: Record<string, unknown>;
};

export type QueueUpdateEvent = PersistentEventBase & {
  type: "queue_update";
  queue: QueueName;
  operation: "rewrite";
  items: QueueItem[];
  anchorEventId: EventId | null;
};

export type SkillIndexEntry = {
  name: string;
  path: string;
  scope: "user" | "project";
  description: string;
  displayName?: string;
  mtimeMs: number;
  size: number;
  contentHash: string;
  priority: number;
  shadowed?: boolean;
  diagnostics?: string[];
};

export type SkillIndexSnapshotEvent = PersistentEventBase & {
  type: "skill_index_snapshot";
  anchorEventId: EventId | null;
  entries: SkillIndexEntry[];
};

export type SkillIndexDeltaEvent = PersistentEventBase & {
  type: "skill_index_delta";
  anchorEventId: EventId | null;
  added: SkillIndexEntry[];
  changed: SkillIndexEntry[];
  removed: { name: string; previousPath: string }[];
};

export type PersistentEvent =
  | SessionHeaderEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolResultEvent
  | InstructionSnapshotEvent
  | HarnessItemEvent
  | QueueUpdateEvent
  | SkillIndexSnapshotEvent
  | SkillIndexDeltaEvent;

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
  | "project_not_found"
  | "project_has_sessions"
  | "filesystem_error"
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
  projectId: ProjectId;
  title?: string;
  model?: string;
  updatedAt: number;
  currentSeq: Seq;
};

export type HostProject = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;
  createdAt: number;
  updatedAt: number;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory";
};

export type DirectoryListing = {
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
};
