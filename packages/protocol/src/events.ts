import type { ClientId, DeviceId, EventId, Seq, SessionId } from "./ids.js";
import type { ScorelMessage, StopReason, Usage } from "./messages.js";

export type SessionMeta = {
  title?: string;
  model?: string;
  deviceId?: DeviceId;
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
};
