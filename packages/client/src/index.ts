import {
  asRequestId,
  asSeq,
  type ClientMessage,
  type ConnectParams,
  type ConnectResult,
  protocolPackageName,
  protocolVersion,
  type ClientId,
  type ClientRequest,
  type ClientRequestMap,
  type ClientRequestType,
  type ContentBlock,
  type CreateSessionMeta,
  type DaemonMessage,
  type DirectoryListing,
  type DaemonTransport,
  type DeviceId,
  type EventId,
  type ExtensionSettings,
  type HostProject,
  type AvailableModelSummary,
  type ModelRole,
  type ProviderCatalogModelSummary,
  type ProviderConnectionSummary,
  type ProviderModelSummary,
  type UpsertModelProfileInput,
  type MemorySettings,
  type UpsertExtensionSettingsInput,
  type UpsertMemorySettingsInput,
  type PersistentEvent,
  type ProjectId,
  type QueueItem,
  type QueueName,
  type ScorelEvent,
  type SendMessageOptions,
  type SendMessageResponse,
  type Seq,
  type SessionId,
  type SessionSummary,
  type Unsubscribe,
} from "@scorel/protocol";

export const clientPackageName = "@scorel/client" as const;
export const clientProtocolDependency = protocolPackageName;
export const clientProtocolVersion = protocolVersion;
export type ClientDaemonTransport = DaemonTransport;
export { RelayTransport, type RelayTransportOptions } from "./relay-transport.js";

/**
 * Public marker error for "the underlying transport tried to write while not
 * connected" (S0045). Every public DaemonClient method that funnels through
 * the transport catches synchronous transport throws and re-emits them as a
 * rejected Promise carrying this error class, so callers in browser /
 * React effect paths can handle a stale-token / closed-socket scenario as a
 * normal rejection instead of an unhandled runtime error.
 *
 * `code` is a const literal for stable string-based dispatch in webui
 * (`session.ts` classifyError, `sidebar.tsx` etc).
 */
export class TransportDisconnectedError extends Error {
  readonly code = "transport_disconnected" as const;
  constructor(message: string) {
    super(message);
    this.name = "TransportDisconnectedError";
  }
}

function isTransportDisconnectedError(
  cause: unknown,
): cause is TransportDisconnectedError {
  if (cause instanceof TransportDisconnectedError) return true;
  if (typeof cause !== "object" || cause === null) return false;
  return (cause as { code?: unknown }).code === "transport_disconnected";
}

function toTransportError(cause: unknown): TransportDisconnectedError {
  if (cause instanceof TransportDisconnectedError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new TransportDisconnectedError(message);
}

/**
 * Heuristic: synchronous throws from `WsTransport.#write` carry the literal
 * "WsTransport is not connected" message. Other transport implementations
 * may throw for unrelated reasons (parse, schema, etc); only the
 * not-connected case is mapped to `TransportDisconnectedError` so daemon-
 * side errors keep their existing reason.
 */
function isTransportNotConnected(cause: unknown): boolean {
  if (cause instanceof TransportDisconnectedError) return true;
  if (cause instanceof Error) {
    return /not connected/i.test(cause.message) && /transport/i.test(cause.message);
  }
  const text = String(cause);
  return /not connected/i.test(text) && /transport/i.test(text);
}

function wrapTransportThrow(cause: unknown): never {
  if (isTransportDisconnectedError(cause) || isTransportNotConnected(cause)) {
    throw toTransportError(cause);
  }
  throw cause;
}

export type WsTransportOptions = {
  url: string;
  token: string;
  createWebSocket?: (url: string) => WebSocketLike;
};

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void, options?: { once?: boolean }): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void, options?: { once?: boolean }): void;
  addEventListener(type: "close", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "error", listener: (event: unknown) => void): void;
};

const websocketOpenState = 1;

export type DaemonClientOptions = {
  clientId: ClientId;
  createRequestId?: () => ReturnType<typeof asRequestId>;
};

export type DaemonConnectionIdentity = {
  deviceId?: DeviceId;
  deviceDisplayName?: string;
};

type PendingRequest<TType extends ClientRequestType = ClientRequestType> = {
  resolve: (data: ClientRequestMap[TType]["response"]) => void;
  reject: (error: Error) => void;
};

export class DaemonClient {
  readonly clientId: ClientId;
  readonly #transport: DaemonTransport;
  readonly #createRequestId: () => ReturnType<typeof asRequestId>;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #subscribers = new Set<(event: ScorelEvent) => void>();
  readonly #events: PersistentEvent[] = [];
  #unsubscribe: Unsubscribe | undefined;
  #state: "disconnected" | "connecting" | "connected" = "disconnected";
  #sessionId: SessionId | null = null;
  #persistentLastSeq: Seq = asSeq(0);
  #streamLastSeq: Seq = asSeq(0);
  #connectionIdentity: DaemonConnectionIdentity = {};
  #requestCounter = 0;

  constructor(transport: DaemonTransport, options: DaemonClientOptions) {
    this.#transport = transport;
    this.clientId = options.clientId;
    this.#createRequestId =
      options.createRequestId ??
      (() => {
        this.#requestCounter += 1;
        return asRequestId(`req_${this.#requestCounter}`);
      });
  }

  get state(): "disconnected" | "connecting" | "connected" {
    return this.#state;
  }

  get sessionId(): SessionId | null {
    return this.#sessionId;
  }

  get lastSeq(): Seq {
    return this.#streamLastSeq;
  }

  get persistentLastSeq(): Seq {
    return this.#persistentLastSeq;
  }

  get streamLastSeq(): Seq {
    return this.#streamLastSeq;
  }

  get connectionIdentity(): DaemonConnectionIdentity {
    return { ...this.#connectionIdentity };
  }

  async connect(sessionId?: SessionId): Promise<void> {
    try {
      this.#state = "connecting";
      this.#unsubscribe ??= this.#transport.onMessage((message) => this.#handleMessage(message));
      const result = await this.#transport.connect({
        clientId: this.clientId,
        sessionId,
        persistentLastSeq: this.#persistentLastSeq,
        streamLastSeq: this.#streamLastSeq,
        lastSeq: this.#streamLastSeq,
      });
      this.#sessionId = result.sessionId ?? sessionId ?? null;
      this.#connectionIdentity = {
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
      };
      this.#state = "connected";
    } catch (cause) {
      // Map transport-level not-connected throws to the public marker error
      // so callers in React effect paths see a rejection rather than an
      // unhandled runtime error (S0045 §4.1).
      wrapTransportThrow(cause);
    }
  }

  disconnect(): void {
    try {
      this.#transport.send({ type: "disconnect", sessionId: this.#sessionId ?? undefined });
    } catch (cause) {
      // Disconnect is a fire-and-forget cleanup; if the socket is already
      // closed we still want to flush local state. Re-throwing would force
      // every caller to wrap a try/catch that has no useful recovery path.
      if (!isTransportNotConnected(cause)) {
        // Non-transport errors are unexpected; log and continue cleanup.
        // eslint-disable-next-line no-console
        console.warn("[scorel/client] transport.send(disconnect) threw:", cause);
      }
    }
    try {
      this.#transport.close();
    } catch {
      /* ignore */
    }
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#state = "disconnected";
  }

  async createSession(input: { sessionId?: SessionId; meta: CreateSessionMeta }): Promise<SessionId> {
    const response = await this.#request("create_session", { meta: input.meta, sessionId: input.sessionId });
    return response.sessionId;
  }

  async loadSession(sessionId: SessionId): Promise<ClientRequestMap["load_session"]["response"]> {
    const response = await this.#request("load_session", { sessionId, lastSeq: this.#persistentLastSeq });
    this.#sessionId = response.sessionId;
    for (const event of response.events) {
      this.#recordEvent(event);
    }
    this.#persistentLastSeq = maxSeq(this.#persistentLastSeq, response.currentSeq);
    this.#streamLastSeq = maxSeq(this.#streamLastSeq, response.currentSeq);
    return response;
  }

  async sendMessage(
    content: string | ContentBlock[],
    options?: SendMessageOptions,
  ): Promise<SendMessageResponse> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    return this.#request("send_message", { sessionId: this.#sessionId, content, options });
  }

  async cancel(): Promise<{ sessionId: SessionId; cancelled: boolean }> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    return this.#request("cancel", { sessionId: this.#sessionId });
  }

  async rewriteQueue(queue: QueueName, items: QueueItem[]): Promise<QueueItem[]> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    return (await this.#request("rewrite_queue", {
      sessionId: this.#sessionId,
      queue,
      items,
    })).items;
  }

  async listSessions(filter?: { projectId?: ProjectId; limit?: number }): Promise<SessionSummary[]> {
    this.#assertDaemonConnected();
    const response = await this.#request("list_sessions", {
      projectId: filter?.projectId,
      limit: filter?.limit,
    });
    return response.sessions;
  }

  async listProjects(): Promise<HostProject[]> {
    this.#assertDaemonConnected();
    const response = await this.#request("list_projects", {});
    return response.projects;
  }

  async listModels(filter?: { projectId?: ProjectId }): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }> {
    this.#assertDaemonConnected();
    return this.#request("list_models", { projectId: filter?.projectId });
  }

  async upsertModelProfile(input: UpsertModelProfileInput): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }> {
    this.#assertDaemonConnected();
    return this.#request("upsert_model_profile", input);
  }

  async fetchProviderModels(input: { projectId: ProjectId; providerId: string }): Promise<ProviderCatalogModelSummary[]> {
    this.#assertDaemonConnected();
    return (await this.#request("fetch_provider_models", input)).models;
  }

  async getMemorySettings(input: { projectId: ProjectId }): Promise<MemorySettings> {
    this.#assertDaemonConnected();
    return (await this.#request("get_memory_settings", input)).memory;
  }

  async upsertMemorySettings(input: UpsertMemorySettingsInput): Promise<MemorySettings> {
    this.#assertDaemonConnected();
    return (await this.#request("upsert_memory_settings", input)).memory;
  }

  async getExtensionSettings(input: { extensionId: string }): Promise<ExtensionSettings> {
    this.#assertDaemonConnected();
    return (await this.#request("get_extension_settings", input)).extension;
  }

  async upsertExtensionSettings(input: UpsertExtensionSettingsInput): Promise<ExtensionSettings> {
    this.#assertDaemonConnected();
    return (await this.#request("upsert_extension_settings", input)).extension;
  }

  async listDirectories(path?: string): Promise<DirectoryListing> {
    this.#assertDaemonConnected();
    return this.#request("list_directories", { path });
  }

  async registerProject(workDir: string): Promise<HostProject> {
    this.#assertDaemonConnected();
    return (await this.#request("register_project", { workDir })).project;
  }

  async removeProject(projectId: ProjectId): Promise<boolean> {
    this.#assertDaemonConnected();
    return (await this.#request("remove_project", { projectId })).removed;
  }

  #assertDaemonConnected(): void {
    if (this.#state !== "connected") {
      throw new Error("DaemonClient is not connected to a daemon");
    }
  }

  async resync(anchors?: Seq | { persistentLastSeq?: Seq; streamLastSeq?: Seq }): Promise<ClientRequestMap["resync_events"]["response"]> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    const legacyFromSeq = typeof anchors === "number" ? anchors : undefined;
    const response = await this.#request("resync_events", {
      sessionId: this.#sessionId,
      fromSeq: legacyFromSeq,
      persistentLastSeq: typeof anchors === "object" ? anchors.persistentLastSeq : this.#persistentLastSeq,
      streamLastSeq: typeof anchors === "object" ? anchors.streamLastSeq : legacyFromSeq ?? this.#streamLastSeq,
    });
    if (response.mode === "full_reload") {
      this.#events.length = 0;
      this.#persistentLastSeq = asSeq(0);
    }
    for (const event of response.events) {
      this.#recordEvent(event);
      for (const subscriber of this.#subscribers) {
        subscriber(event);
      }
    }
    if (response.mode === "persistent_fallback" || response.mode === "full_reload") {
      this.#persistentLastSeq = maxSeq(this.#persistentLastSeq, response.throughSeq);
      this.#streamLastSeq = maxSeq(this.#streamLastSeq, response.throughSeq);
    } else {
      this.#streamLastSeq = maxSeq(this.#streamLastSeq, response.throughSeq);
    }
    return response;
  }

  subscribe(handler: (event: ScorelEvent) => void): Unsubscribe {
    this.#subscribers.add(handler);
    return () => {
      this.#subscribers.delete(handler);
    };
  }

  getEvents(): PersistentEvent[] {
    return [...this.#events];
  }

  getActiveLeaf(): EventId | null {
    return this.#events.at(-1)?.id ?? null;
  }

  #request<TType extends ClientRequestType>(
    type: TType,
    payload: ClientRequestMap[TType]["request"],
  ): Promise<ClientRequestMap[TType]["response"]> {
    const requestId = this.#createRequestId();
    const request = {
      type,
      requestId,
      ...payload,
    } as ClientRequest<TType>;

    return new Promise((resolve, reject) => {
      this.#pending.set(String(requestId), { resolve, reject } as PendingRequest);
      try {
        this.#transport.send(request as ClientRequest);
      } catch (cause) {
        // Synchronous throw from transport.send (e.g. socket already
        // closed). The Promise body would auto-reject, but we drop the
        // pending entry first so a late `error` message doesn't try to
        // reject the same request twice. Map to the public marker error
        // so webui can classify it as `transport_disconnected` (S0045).
        this.#pending.delete(String(requestId));
        if (isTransportDisconnectedError(cause) || isTransportNotConnected(cause)) {
          reject(toTransportError(cause));
        } else {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }
    });
  }

  #handleMessage(message: DaemonMessage): void {
    switch (message.type) {
      case "event":
        this.#recordEvent(message.event);
        for (const subscriber of this.#subscribers) {
          subscriber(message.event);
        }
        break;
      case "response": {
        const pending = this.#pending.get(String(message.requestId));
        if (pending) {
          this.#pending.delete(String(message.requestId));
          pending.resolve(message.data);
        }
        break;
      }
      case "error": {
        if (message.requestId) {
          const pending = this.#pending.get(String(message.requestId));
          if (pending) {
            this.#pending.delete(String(message.requestId));
            pending.reject(new Error(message.message));
          }
        }
        break;
      }
      case "connected":
        this.#sessionId = message.sessionId ?? this.#sessionId;
        // Merge: a follow-up `connected` (e.g. duplicate ack from a server that
        // sends one manually plus the default) must not blank out identity
        // fields the first message established.
        this.#connectionIdentity = {
          deviceId: message.deviceId ?? this.#connectionIdentity.deviceId,
          deviceDisplayName:
            message.deviceDisplayName ?? this.#connectionIdentity.deviceDisplayName,
        };
        break;
      case "disconnected":
        this.#state = "disconnected";
        break;
      case "pong":
        break;
    }
  }

  #recordEvent(event: ScorelEvent): void {
    this.#streamLastSeq = maxSeq(this.#streamLastSeq, event.seq);
    if ("id" in event) {
      this.#persistentLastSeq = maxSeq(this.#persistentLastSeq, event.seq);
      const existingIndex = this.#events.findIndex((candidate) => candidate.id === event.id);
      if (existingIndex >= 0) {
        this.#events[existingIndex] = event;
      } else {
        this.#events.push(event);
      }
    }
  }
}

const maxSeq = (left: Seq, right: Seq): Seq => asSeq(Math.max(Number(left), Number(right)));

export class WsTransport implements DaemonTransport {
  readonly url: string;
  readonly #token: string;
  readonly #createWebSocket: (url: string) => WebSocketLike;
  readonly #handlers = new Set<(message: DaemonMessage) => void>();
  #socket: WebSocketLike | undefined;

  constructor(options: WsTransportOptions) {
    this.url = options.url;
    this.#token = options.token;
    this.#createWebSocket =
      options.createWebSocket ??
      ((url) => {
        if (typeof WebSocket === "undefined") {
          throw new Error("WebSocket is not available in this runtime");
        }
        return new WebSocket(url);
      });
  }

  connect(params: ConnectParams): Promise<ConnectResult> {
    return new Promise((resolve, reject) => {
      const socket = this.#createWebSocket(this.url);
      this.#socket = socket;
      const rejectOnError = (event: unknown) => {
        socket.removeEventListener("error", rejectOnError);
        reject(event instanceof Error ? event : new Error("WebSocket connection failed"));
      };
      socket.addEventListener("error", rejectOnError, { once: true });
      socket.addEventListener("message", (event) => this.#handleMessageData(event.data));
      const unsubscribe = this.onMessage((message) => {
        if (message.type === "error") {
          unsubscribe();
          socket.removeEventListener("error", rejectOnError);
          reject(new Error(message.message));
          return;
        }
        if (message.type !== "connected") {
          return;
        }
        unsubscribe();
        socket.removeEventListener("error", rejectOnError);
        resolve({
          clientId: message.clientId,
          sessionId: message.sessionId,
          currentSeq: message.currentSeq,
          deviceId: message.deviceId,
          deviceDisplayName: message.deviceDisplayName,
        });
      });
      socket.addEventListener(
        "open",
        () => {
          this.#write({ type: "connect", ...params, token: this.#token });
        },
        { once: true },
      );
    });
  }

  send(message: ClientMessage): void {
    this.#write(message);
  }

  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  close(): void {
    this.#socket?.close();
    this.#socket = undefined;
    this.#handlers.clear();
  }

  #write(message: ClientMessage | (ConnectParams & { type: "connect"; token: string })): void {
    if (!this.#socket || this.#socket.readyState !== websocketOpenState) {
      throw new Error("WsTransport is not connected");
    }
    this.#socket.send(JSON.stringify(message));
  }

  #handleMessageData(data: unknown): void {
    const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data);
    const message = JSON.parse(text) as DaemonMessage;
    for (const handler of this.#handlers) {
      handler(message);
    }
  }
}
