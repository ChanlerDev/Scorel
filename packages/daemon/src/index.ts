import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

import {
  ScorelRuntime,
  buildContext,
  corePackageName,
  createCodingTools,
  createPiAiProvider,
  createSession,
  loadScorelConfig,
  loadSession,
  resolvePiAiModel,
  scorelSessionsDir,
  type ScorelConfig,
  type JsonlSession,
  type RawRuntimeEvent,
} from "@scorel/core";
import {
  asClientId,
  asEventId,
  asSeq,
  asSessionId,
  protocolPackageName,
  protocolVersion,
  type ClientId,
  type ClientMessage,
  type ClientRequest,
  type ConnectParams,
  type ConnectResult,
  type DaemonTransport,
  type DaemonMessage,
  type DeviceId,
  type EventId,
  type PersistentEvent,
  type ScorelEvent,
  type Seq,
  type SessionId,
  type SessionMeta,
  type ScorelMessage,
  type TransientEvent,
  type Unsubscribe,
} from "@scorel/protocol";

export const daemonPackageName = "@scorel/daemon" as const;
export const daemonCoreDependency = corePackageName;
export const daemonProtocolDependency = protocolPackageName;
export const daemonProtocolVersion = protocolVersion;
export type EmbeddedDaemonTransport = DaemonTransport;
export { loadScorelConfig, scorelSessionsDir, type ScorelConfig };

export type LocalDaemonState = {
  pid: number;
  socketPath: string;
  token: string;
  startedAt: number;
};

export type LocalDaemonStateOptions = {
  stateDir: string;
};

export type CreateLocalDaemonStateOptions = LocalDaemonStateOptions & LocalDaemonState;

export type LocalDaemonSocketConnection = {
  clientId?: ClientId;
  socket: Socket;
  send(message: DaemonMessage): void;
};

export type LocalDaemonSocketServerOptions = {
  socketPath: string;
  token: string;
  onClientConnect?: (connection: LocalDaemonSocketConnection, params: ConnectParams) => ConnectResult;
  onClientMessage: (connection: LocalDaemonSocketConnection, message: ClientMessage) => DaemonMessage | void;
};

export type LocalDaemonSocketServer = {
  socketPath: string;
  close(): Promise<void>;
};

const localDaemonStateFile = (stateDir: string): string => join(stateDir, "daemon.json");

export const createLocalDaemonState = async (options: CreateLocalDaemonStateOptions): Promise<LocalDaemonState> => {
  const state = {
    pid: options.pid,
    socketPath: options.socketPath,
    token: options.token,
    startedAt: options.startedAt,
  };
  await mkdir(options.stateDir, { recursive: true });
  await writeFile(localDaemonStateFile(options.stateDir), `${JSON.stringify(state, null, 2)}\n`);
  return state;
};

export const readLocalDaemonState = async (options: LocalDaemonStateOptions): Promise<LocalDaemonState | null> => {
  try {
    return JSON.parse(await readFile(localDaemonStateFile(options.stateDir), "utf8")) as LocalDaemonState;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return null;
    }
    throw cause;
  }
};

export const removeLocalDaemonState = async (options: LocalDaemonStateOptions): Promise<void> => {
  await rm(localDaemonStateFile(options.stateDir), { force: true });
};

export const startLocalDaemonSocketServer = async (
  options: LocalDaemonSocketServerOptions,
): Promise<LocalDaemonSocketServer> => {
  await rm(options.socketPath, { force: true });
  const server = createServer((socket) => {
    let buffer = "";
    const connection: LocalDaemonSocketConnection = {
      socket,
      send(message) {
        socket.write(`${JSON.stringify(message)}\n`);
      },
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as ClientMessage | ({ type: "connect"; token: string } & ConnectParams);
        if (message.type === "connect") {
          if (message.token !== options.token) {
            connection.send({
              type: "error",
              ok: false,
              code: "invalid_request",
              message: "invalid local token",
            });
            socket.end();
            continue;
          }
          connection.clientId = message.clientId;
          const result = options.onClientConnect?.(connection, message) ?? {
            clientId: message.clientId,
            sessionId: message.sessionId,
            currentSeq: message.lastSeq ?? asSeq(0),
          };
          connection.send({
            type: "connected",
            clientId: result.clientId,
            sessionId: result.sessionId,
            currentSeq: result.currentSeq,
          });
          continue;
        }
        const response = options.onClientMessage(connection, message);
        if (response) {
          connection.send(response);
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    socketPath: options.socketPath,
    close: async () => {
      await closeServer(server);
      await rm(options.socketPath, { force: true });
    },
  };
};

export const startEmbeddedDaemonSocketServer = async (
  options: { daemon: EmbeddedDaemon; socketPath: string; token: string },
): Promise<LocalDaemonSocketServer> => {
  const connections = new WeakMap<LocalDaemonSocketConnection, Connection>();
  const daemonConnectionFor = (socketConnection: LocalDaemonSocketConnection, params?: ConnectParams): Connection => {
    const existing = connections.get(socketConnection);
    if (existing) {
      return existing;
    }
    const connection: Connection = {
      clientId: params?.clientId ?? asClientId("socket_unconnected"),
      emit: (daemonMessage) => socketConnection.send(daemonMessage),
    };
    connections.set(socketConnection, connection);
    return connection;
  };

  return startLocalDaemonSocketServer({
    socketPath: options.socketPath,
    token: options.token,
    onClientConnect: (socketConnection, params) => {
      const daemonConnection = daemonConnectionFor(socketConnection, params);
      daemonConnection.clientId = params.clientId;
      const result = options.daemon.connect(daemonConnection, params.sessionId);
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
      };
    },
    onClientMessage: (socketConnection, message) => {
      const daemonConnection = daemonConnectionFor(socketConnection);
      if (!daemonConnection.clientId) {
        return {
          type: "error",
          ok: false,
          code: "invalid_request",
          message: "socket is not connected",
        };
      }
      void options.daemon.handleMessage(daemonConnection, message).catch((cause) => {
        socketConnection.send({
          type: "error",
          ok: false,
          code: "internal_error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
      return undefined;
    },
  });
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

export type RuntimeFactoryOptions = {
  cwd: string;
  config: ScorelConfig;
};

export type EmbeddedDaemonOptions = {
  sessionsDir: string;
  deviceId: DeviceId;
  createRuntime: (sessionId: SessionId) => ScorelRuntime;
  now?: () => number;
  createId?: () => string;
};

export const createRealRuntime = (options: RuntimeFactoryOptions): ScorelRuntime => {
  const model = resolvePiAiModel(options.config.model);
  const runtime = new ScorelRuntime({
    provider: createPiAiProvider({
      model,
      apiKey: options.config.model.apiKey,
    }),
  });
  for (const tool of createCodingTools({ cwd: options.cwd, contextWindow: model.contextWindow })) {
    runtime.registerTool(tool);
  }
  return runtime;
};

type SessionLane = {
  session: JsonlSession;
  runtime: ScorelRuntime;
  queue: Promise<unknown>;
};

type PersistentEventInput =
  | Omit<Extract<PersistentEvent, { type: "user_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "assistant_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "tool_result" }>, "seq">;

type TransientEventInput =
  | Omit<Extract<TransientEvent, { type: "turn_start" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "turn_end" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "message_start" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "text_delta" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "error" }>, "seq">;

type Connection = {
  clientId: ClientId;
  sessionId?: SessionId;
  emit: (message: DaemonMessage) => void;
};

type RuntimeEventState = {
  parentId: EventId;
  assistantEventId: EventId;
  finalAssistantEventId: EventId;
};

export class EmbeddedDaemon {
  readonly #sessionsDir: string;
  readonly #deviceId: DeviceId;
  readonly #createRuntime: (sessionId: SessionId) => ScorelRuntime;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #sessions = new Map<SessionId, SessionLane>();
  readonly #connections = new Set<Connection>();
  readonly #events = new Map<SessionId, ScorelEvent[]>();
  readonly #seqs = new Map<SessionId, number>();
  #started = false;

  constructor(options: EmbeddedDaemonOptions) {
    this.#sessionsDir = options.sessionsDir;
    this.#deviceId = options.deviceId;
    this.#createRuntime = options.createRuntime;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async start(): Promise<void> {
    this.#started = true;
  }

  async shutdown(): Promise<void> {
    this.#connections.clear();
    this.#started = false;
  }

  connect(connection: Connection, sessionId?: SessionId): { currentSeq: Seq; sessionId?: SessionId } {
    this.#assertStarted();
    connection.sessionId = sessionId;
    this.#connections.add(connection);
    return {
      sessionId,
      currentSeq: asSeq(sessionId ? (this.#seqs.get(sessionId) ?? 0) : 0),
    };
  }

  disconnect(connection: Connection): void {
    this.#connections.delete(connection);
  }

  async handleMessage(connection: Connection, message: ClientMessage): Promise<void> {
    this.#assertStarted();
    switch (message.type) {
      case "create_session":
        await this.#handleCreateSession(connection, message);
        break;
      case "load_session":
        await this.#handleLoadSession(connection, message);
        break;
      case "send_message":
        await this.#handleSendMessage(connection, message);
        break;
      case "resync_events":
        this.#respond(connection, message, {
          events: this.#eventsAfter(message.sessionId, message.fromSeq),
          throughSeq: asSeq(this.#seqs.get(message.sessionId) ?? 0),
        });
        break;
      case "subscribe_events":
        connection.sessionId = message.sessionId;
        this.#respond(connection, message, {
          currentSeq: asSeq(this.#seqs.get(message.sessionId) ?? 0),
        });
        break;
      case "get_status":
        this.#respond(connection, message, {
          running: false,
          activeClients: [...this.#connections].map((candidate) => candidate.clientId),
          sessionCount: this.#sessions.size,
          uptimeMs: 0,
        });
        break;
      case "ping":
        connection.emit({ type: "pong", requestId: message.requestId });
        break;
      case "disconnect":
        this.disconnect(connection);
        break;
      case "list_sessions":
        connection.emit({
          type: "error",
          requestId: message.requestId,
          ok: false,
          code: "invalid_request",
          message: `${message.type} is not implemented in embedded M1`,
        });
        break;
    }
  }

  async #handleCreateSession(connection: Connection, request: ClientRequest<"create_session">): Promise<void> {
    const sessionId = request.sessionId ?? asSessionId(`ses_${this.#createId()}`);
    const lane = await this.#createLane(sessionId, request.meta ?? {});
    this.#sessions.set(sessionId, lane);
    this.#events.set(sessionId, []);
    this.#seqs.set(sessionId, 0);
    this.#respond(connection, request, { sessionId });
  }

  async #handleLoadSession(connection: Connection, request: ClientRequest<"load_session">): Promise<void> {
    try {
      const lane = await this.#getLane(request.sessionId);
      connection.sessionId = request.sessionId;
      const persistentEvents = [...lane.session.tree];
      const sessionEvents = this.#events.get(request.sessionId) ?? [];
      if (sessionEvents.length === 0 && persistentEvents.length > 0) {
        this.#events.set(request.sessionId, persistentEvents);
      }
      this.#respond(connection, request, {
        sessionId: request.sessionId,
        activeLeafId: lane.session.activeLeafId,
        currentSeq: lane.session.currentSeq,
        events: persistentEvents,
        meta: lane.session.header.meta,
      });
    } catch (cause) {
      connection.emit({
        type: "error",
        requestId: request.requestId,
        ok: false,
        code: "session_not_found",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  async #handleSendMessage(connection: Connection, request: ClientRequest<"send_message">): Promise<void> {
    const lane = await this.#getLane(request.sessionId);
    lane.queue = lane.queue.then(async () => {
      const userEventId = asEventId(this.#createId());
      const content = typeof request.content === "string" ? [{ type: "text" as const, text: request.content }] : request.content;
      const userEvent = await this.#appendPersistent(lane, {
        type: "user_message",
        id: userEventId,
        parentId: request.options?.parentId ?? lane.session.activeLeafId,
        sessionId: request.sessionId,
        clientId: connection.clientId,
        ts: this.#now(),
        message: { role: "user", content },
      });
      const firstAssistantEventId = asEventId(this.#createId());
      const state: RuntimeEventState = {
        parentId: userEvent.id,
        assistantEventId: firstAssistantEventId,
        finalAssistantEventId: firstAssistantEventId,
      };

      for await (const rawEvent of lane.runtime.executeTurn(buildContext(lane.session.tree, userEvent.id), undefined, {})) {
        await this.#handleRuntimeEvent(lane, connection.clientId, state, rawEvent);
      }

      this.#respond(connection, request, { userEventId, assistantEventId: state.finalAssistantEventId });
    });

    await lane.queue;
  }

  async #handleRuntimeEvent(
    lane: SessionLane,
    clientId: ClientId,
    state: RuntimeEventState,
    rawEvent: RawRuntimeEvent,
  ): Promise<void> {
    switch (rawEvent.type) {
      case "turn_start":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "turn_start",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          turnIndex: 0,
        });
        break;
      case "message_start":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "message_start",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          eventId: state.assistantEventId,
          parentId: state.parentId,
          role: rawEvent.role,
        });
        break;
      case "text_delta":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "text_delta",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          eventId: state.assistantEventId,
          delta: rawEvent.delta,
        });
        break;
      case "message_end": {
        const appended = (
          await this.#appendPersistent(lane, {
            type: "assistant_message",
            id: state.assistantEventId,
            parentId: state.parentId,
            sessionId: lane.session.header.sessionId,
            clientId,
            ts: this.#now(),
            message: rawEvent.message,
          })
        ).id;
        state.parentId = appended;
        state.finalAssistantEventId = appended;
        state.assistantEventId = asEventId(this.#createId());
        break;
      }
      case "tool_execution_start":
        break;
      case "tool_execution_end": {
        const toolResultId = asEventId(this.#createId());
        await this.#appendPersistent(lane, {
          type: "tool_result",
          id: toolResultId,
          parentId: state.parentId,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          message: {
            role: "tool_result",
            content: [
              {
                type: "tool_result",
                toolCallId: rawEvent.toolCallId,
                toolName: rawEvent.toolName,
                result: rawEvent.result,
                isError: rawEvent.isError,
              },
            ],
          },
        });
        state.parentId = toolResultId;
        break;
      }
      case "turn_end":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "turn_end",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          turnIndex: 0,
          stopReason: rawEvent.stopReason,
        });
        break;
      case "error":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "error",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          code: "internal_error",
          message: rawEvent.error.message,
        });
        break;
    }
  }

  async #appendPersistent(
    lane: SessionLane,
    event: PersistentEventInput,
  ): Promise<PersistentEvent> {
    const withSeq = { ...event, seq: this.#nextSeq(lane.session.header.sessionId) } as PersistentEvent;
    await lane.session.append(withSeq);
    this.#recordAndBroadcast(lane.session.header.sessionId, withSeq);
    return withSeq;
  }

  #broadcastTransient(sessionId: SessionId, event: TransientEventInput): TransientEvent {
    const withSeq = { ...event, seq: this.#nextSeq(sessionId) } as TransientEvent;
    this.#recordAndBroadcast(sessionId, withSeq);
    return withSeq;
  }

  #recordAndBroadcast(sessionId: SessionId, event: ScorelEvent): void {
    const events = this.#events.get(sessionId) ?? [];
    events.push(event);
    this.#events.set(sessionId, events);
    for (const connection of this.#connections) {
      if (connection.sessionId === sessionId) {
        connection.emit({ type: "event", event });
      }
    }
  }

  #nextSeq(sessionId: SessionId): Seq {
    const next = (this.#seqs.get(sessionId) ?? 0) + 1;
    this.#seqs.set(sessionId, next);
    return asSeq(next);
  }

  #eventsAfter(sessionId: SessionId, fromSeq: Seq | undefined): ScorelEvent[] {
    const from = Number(fromSeq ?? 0);
    return (this.#events.get(sessionId) ?? []).filter((event) => Number(event.seq) > from);
  }

  async #getLane(sessionId: SessionId): Promise<SessionLane> {
    const existing = this.#sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const loaded = await loadSession({ sessionsDir: this.#sessionsDir, sessionId });
    const lane = {
      session: loaded,
      runtime: this.#createRuntime(sessionId),
      queue: Promise.resolve(),
    };
    this.#sessions.set(sessionId, lane);
    this.#seqs.set(sessionId, Number(loaded.currentSeq));
    return lane;
  }

  async #createLane(sessionId: SessionId, meta: Partial<SessionMeta>): Promise<SessionLane> {
    const session = await createSession({
      sessionsDir: this.#sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId: this.#deviceId,
        createdAt: this.#now(),
        meta,
      },
    });
    return {
      session,
      runtime: this.#createRuntime(sessionId),
      queue: Promise.resolve(),
    };
  }

  #respond<TRequest extends ClientRequest>(
    connection: Connection,
    request: TRequest,
    data: unknown,
  ): void {
    connection.emit({
      type: "response",
      requestType: request.type,
      requestId: request.requestId,
      ok: true,
      data,
    } as DaemonMessage);
  }

  #assertStarted(): void {
    if (!this.#started) {
      throw new Error("EmbeddedDaemon is not started");
    }
  }
}

export const createEmbeddedTransport = (daemon: EmbeddedDaemon): DaemonTransport => {
  const handlers = new Set<(message: DaemonMessage) => void>();
  const connection: Connection = {
    clientId: asClientId("embedded_unconnected"),
    emit: (message) => {
      for (const handler of handlers) {
        handler(message);
      }
    },
  };

  return {
    async connect(params) {
      connection.clientId = params.clientId;
      const result = daemon.connect(connection, params.sessionId);
      connection.emit({
        type: "connected",
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
      });
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
      };
    },
    send(message) {
      return daemon.handleMessage(connection, message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      daemon.disconnect(connection);
      handlers.clear();
    },
  };
};
