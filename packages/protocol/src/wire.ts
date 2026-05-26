import type { ClientId, EventId, RequestId, Seq, SessionId } from "./ids.js";
import type {
  DaemonStatus,
  ErrorCode,
  PersistentEvent,
  ScorelEvent,
  SessionMeta,
  SessionSummary,
} from "./events.js";
import type { ContentBlock } from "./messages.js";

export type SendMessageOptions = {
  parentId?: EventId | null;
};

export type ClientRequestMap = {
  create_session: {
    request: { sessionId?: SessionId; meta?: Partial<SessionMeta> };
    response: { sessionId: SessionId };
  };
  load_session: {
    request: { sessionId: SessionId; lastSeq?: Seq };
    response: {
      sessionId: SessionId;
      activeLeafId: EventId | null;
      currentSeq: Seq;
      events: PersistentEvent[];
      meta: SessionMeta;
    };
  };
  list_sessions: {
    request: Record<never, never>;
    response: { sessions: SessionSummary[] };
  };
  send_message: {
    request: { sessionId: SessionId; content: string | ContentBlock[]; options?: SendMessageOptions };
    response: { userEventId: EventId; assistantEventId: EventId };
  };
  get_status: {
    request: { sessionId?: SessionId };
    response: DaemonStatus;
  };
  subscribe_events: {
    request: { sessionId: SessionId; lastSeq?: Seq };
    response: { currentSeq: Seq };
  };
  resync_events: {
    request: { sessionId: SessionId; fromSeq?: Seq };
    response: { events: ScorelEvent[]; throughSeq: Seq };
  };
};

export type ClientRequestType = keyof ClientRequestMap;

export type ClientRequest<TType extends ClientRequestType = ClientRequestType> = {
  [K in TType]: {
    type: K;
    requestId: RequestId;
  } & ClientRequestMap[K]["request"];
}[TType];

export type ClientMessage =
  | ClientRequest
  | { type: "disconnect"; sessionId?: SessionId }
  | { type: "ping"; requestId?: RequestId };

export type ResponseFor<TRequest extends ClientRequest> =
  ClientResponse<TRequest["type"]>;

export type ClientResponse<TType extends ClientRequestType = ClientRequestType> = {
  [K in TType]: {
    type: "response";
    requestType: K;
    requestId: RequestId;
    ok: true;
    data: ClientRequestMap[K]["response"];
  };
}[TType];

export type ErrorResponse = {
  type: "error";
  requestId?: RequestId;
  ok: false;
  code: ErrorCode;
  message: string;
};

export type DaemonMessage =
  | { type: "connected"; clientId: ClientId; sessionId?: SessionId; currentSeq?: Seq }
  | { type: "disconnected"; reason: string }
  | { type: "pong"; requestId?: RequestId }
  | { type: "event"; event: ScorelEvent }
  | ClientResponse
  | ErrorResponse;

export const okResponse = <TRequest extends ClientRequest>(
  request: TRequest,
  data: ClientRequestMap[TRequest["type"]]["response"],
): ResponseFor<TRequest> => ({
  type: "response",
  requestType: request.type,
  requestId: request.requestId,
  ok: true,
  data,
}) as ResponseFor<TRequest>;
