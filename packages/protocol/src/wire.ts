import type { ClientId, DeviceId, EventId, ProjectId, RequestId, Seq, SessionId } from "./ids.js";
import type {
  CreateSessionMeta,
  DaemonStatus,
  DirectoryListing,
  ErrorCode,
  ExtensionSettings,
  HostProject,
  AvailableModelSummary,
  ModelRole,
  ProviderConnectionSummary,
  ProviderCatalogModelSummary,
  ProviderModelSummary,
  RemoveModelProviderInput,
  UpsertModelProfileInput,
  MemoryStatus,
  MemorySettings,
  RuntimeSettings,
  UpsertExtensionSettingsInput,
  UpsertMemorySettingsInput,
  UpsertRuntimeSettingsInput,
  PersistentEvent,
  QueueItem,
  QueueName,
  ScorelEvent,
  SessionMeta,
  SessionSummary,
} from "./events.js";
import type { ContentBlock } from "./messages.js";

export type SendMessageOptions = {
  parentId?: EventId | null;
  runningBehavior?: QueueName;
  channelContext?: ChannelContext;
};

export type ChannelContext = {
  channel: string;
  externalConversationId: string;
  conversationType?: string;
  senderDisplayName?: string;
  mentionedBot?: boolean;
  data?: Record<string, unknown>;
};

export type SendMessageResponse = {
  status: "completed" | "queued";
  userEventId?: EventId;
  assistantEventId?: EventId;
  queue?: QueueName;
  queueItemId?: string;
};

export type ClientRequestMap = {
  create_session: {
    request: { sessionId?: SessionId; meta: CreateSessionMeta };
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
    request: { projectId?: ProjectId; limit?: number };
    response: { sessions: SessionSummary[] };
  };
  list_projects: {
    request: Record<never, never>;
    response: { projects: HostProject[] };
  };
  list_models: {
    request: { projectId?: ProjectId };
    response: { providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] };
  };
  upsert_model_profile: {
    request: UpsertModelProfileInput;
    response: { providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] };
  };
  fetch_provider_models: {
    request: { projectId: ProjectId; providerId: string };
    response: { models: ProviderCatalogModelSummary[] };
  };
  remove_model_provider: {
    request: RemoveModelProviderInput;
    response: { providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[]; removed: boolean };
  };
  get_memory_settings: {
    request: { projectId: ProjectId };
    response: { memory: MemorySettings };
  };
  get_memory_status: {
    request: { projectId: ProjectId };
    response: { status: MemoryStatus };
  };
  upsert_memory_settings: {
    request: UpsertMemorySettingsInput;
    response: { memory: MemorySettings };
  };
  get_runtime_settings: {
    request: { projectId: ProjectId };
    response: { runtime: RuntimeSettings };
  };
  upsert_runtime_settings: {
    request: UpsertRuntimeSettingsInput;
    response: { runtime: RuntimeSettings };
  };
  get_extension_settings: {
    request: { extensionId: string };
    response: { extension: ExtensionSettings };
  };
  upsert_extension_settings: {
    request: UpsertExtensionSettingsInput;
    response: { extension: ExtensionSettings };
  };
  list_directories: {
    request: { path?: string };
    response: DirectoryListing;
  };
  register_project: {
    request: { workDir: string };
    response: { project: HostProject };
  };
  remove_project: {
    request: { projectId: ProjectId };
    response: { projectId: ProjectId; removed: boolean };
  };
  cancel: {
    request: { sessionId: SessionId };
    response: { sessionId: SessionId; cancelled: boolean };
  };
  send_message: {
    request: { sessionId: SessionId; content: string | ContentBlock[]; options?: SendMessageOptions };
    response: SendMessageResponse;
  };
  rewrite_queue: {
    request: { sessionId: SessionId; queue: QueueName; items: QueueItem[] };
    response: { sessionId: SessionId; queue: QueueName; items: QueueItem[] };
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
    request: { sessionId: SessionId; persistentLastSeq?: Seq; streamLastSeq?: Seq; fromSeq?: Seq };
    response: {
      events: ScorelEvent[];
      throughSeq: Seq;
      mode: "stream_resume" | "persistent_fallback" | "full_reload";
      gapFromSeq?: Seq;
      gapToSeq?: Seq;
    };
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
  | {
      type: "connected";
      clientId: ClientId;
      sessionId?: SessionId;
      currentSeq?: Seq;
      deviceId: DeviceId;
      deviceDisplayName?: string;
    }
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
