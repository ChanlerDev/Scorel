import {
  asRequestId,
  asSeq,
  protocolPackageName,
  protocolVersion,
  type ClientId,
  type ClientRequest,
  type ClientRequestMap,
  type ClientRequestType,
  type ContentBlock,
  type DaemonMessage,
  type DaemonTransport,
  type EventId,
  type PersistentEvent,
  type ScorelEvent,
  type Seq,
  type SessionId,
  type SessionMeta,
  type Unsubscribe,
} from "@scorel/protocol";

export const clientPackageName = "@scorel/client" as const;
export const clientProtocolDependency = protocolPackageName;
export const clientProtocolVersion = protocolVersion;
export type ClientDaemonTransport = DaemonTransport;

export type DaemonClientOptions = {
  clientId: ClientId;
  createRequestId?: () => ReturnType<typeof asRequestId>;
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
  #lastSeq: Seq = asSeq(0);
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
    return this.#lastSeq;
  }

  async connect(sessionId: SessionId): Promise<void> {
    this.#state = "connecting";
    this.#unsubscribe ??= this.#transport.onMessage((message) => this.#handleMessage(message));
    const result = await this.#transport.connect({
      clientId: this.clientId,
      sessionId,
      lastSeq: this.#lastSeq,
    });
    this.#sessionId = result.sessionId ?? sessionId;
    this.#lastSeq = result.currentSeq ?? this.#lastSeq;
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
    const response = await this.#request("load_session", { sessionId, lastSeq: this.#lastSeq });
    this.#sessionId = response.sessionId;
    this.#lastSeq = response.currentSeq;
    for (const event of response.events) {
      this.#recordEvent(event);
    }
    return response;
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

  async resync(fromSeq?: Seq): Promise<void> {
    if (!this.#sessionId) {
      throw new Error("DaemonClient is not connected to a session");
    }
    const response = await this.#request("resync_events", { sessionId: this.#sessionId, fromSeq });
    for (const event of response.events) {
      this.#recordEvent(event);
    }
    this.#lastSeq = response.throughSeq;
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
        this.#lastSeq = message.currentSeq ?? this.#lastSeq;
        break;
      case "disconnected":
        this.#state = "disconnected";
        break;
      case "pong":
        break;
    }
  }

  #recordEvent(event: ScorelEvent): void {
    this.#lastSeq = event.seq;
    if ("id" in event) {
      const existingIndex = this.#events.findIndex((candidate) => candidate.id === event.id);
      if (existingIndex >= 0) {
        this.#events[existingIndex] = event;
      } else {
        this.#events.push(event);
      }
    }
  }
}
