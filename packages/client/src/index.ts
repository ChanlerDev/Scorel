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
  type DaemonMessage,
  type DaemonTransport,
  type DeviceId,
  type EventId,
  type PersistentEvent,
  type ScorelEvent,
  type Seq,
  type SessionId,
  type SessionMeta,
  type SessionSummary,
  type Unsubscribe,
} from "@scorel/protocol";

export const clientPackageName = "@scorel/client" as const;
export const clientProtocolDependency = protocolPackageName;
export const clientProtocolVersion = protocolVersion;
export type ClientDaemonTransport = DaemonTransport;

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
  projectSlug?: string;
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
      projectSlug: result.projectSlug,
    };
    this.#state = "connected";
  }

  disconnect(): void {
    this.#transport.send({ type: "disconnect", sessionId: this.#sessionId ?? undefined });
    this.#transport.close();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#state = "disconnected";
  }

  async createSession(input: { sessionId?: SessionId; meta?: Partial<SessionMeta> }): Promise<SessionId> {
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

  async listSessions(): Promise<SessionSummary[]> {
    const response = await this.#request("list_sessions", {});
    return response.sessions;
  }

  async sendMessage(
    content: string | ContentBlock[],
    options?: { parentId?: EventId | null },
  ): Promise<{ userEventId: EventId; assistantEventId: EventId }> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    return this.#request("send_message", { sessionId: this.#sessionId, content, options });
  }

  async cancel(): Promise<ClientRequestMap["cancel"]["response"]> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    return this.#request("cancel", { sessionId: this.#sessionId });
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
      void this.#transport.send(request as ClientRequest);
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
        this.#connectionIdentity = {
          deviceId: message.deviceId,
          deviceDisplayName: message.deviceDisplayName,
          projectSlug: message.projectSlug,
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
          projectSlug: message.projectSlug,
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
