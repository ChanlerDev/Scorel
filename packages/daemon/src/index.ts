import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

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
  sessionLogFilePath,
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
  type ClientRequestMap,
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

export type RemoteDaemonWebSocketConnection = {
  clientId?: ClientId;
  socket: WebSocket;
  send(message: DaemonMessage): void;
};

export type RemoteDaemonWebSocketServerOptions = {
  host: string;
  port: number;
  token: string;
  onClientConnect?: (connection: RemoteDaemonWebSocketConnection, params: ConnectParams) => ConnectResult;
  onClientMessage: (connection: RemoteDaemonWebSocketConnection, message: ClientMessage) => DaemonMessage | void;
};

export type RemoteDaemonWebSocketServer = {
  host: string;
  port: number;
  url: string;
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
        if (!socket.destroyed && socket.writable) {
          socket.write(`${JSON.stringify(message)}\n`);
        }
      },
    };

    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
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
            currentSeq: message.streamLastSeq ?? message.lastSeq ?? asSeq(0),
          };
          connection.send({
            type: "connected",
            clientId: result.clientId,
            sessionId: result.sessionId,
            currentSeq: result.currentSeq,
            deviceId: result.deviceId,
            deviceDisplayName: result.deviceDisplayName,
            projectSlug: result.projectSlug,
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

export const startRemoteDaemonWebSocketServer = async (
  options: RemoteDaemonWebSocketServerOptions,
): Promise<RemoteDaemonWebSocketServer> => {
  const server = new WebSocketServer({ host: options.host, port: options.port });
  server.on("connection", (socket) => {
    const connection: RemoteDaemonWebSocketConnection = {
      socket,
      send(message) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    };

    socket.on("message", (data) => {
      let message: ClientMessage | ({ type: "connect"; token: string } & ConnectParams);
      try {
        message = JSON.parse(data.toString()) as ClientMessage | ({ type: "connect"; token: string } & ConnectParams);
      } catch {
        connection.send({
          type: "error",
          ok: false,
          code: "invalid_request",
          message: "invalid JSON message",
        });
        return;
      }

      if (message.type === "connect") {
        if (message.token !== options.token) {
          connection.send({
            type: "error",
            ok: false,
            code: "auth_failed",
            message: "invalid remote token",
          });
          socket.close();
          return;
        }
        connection.clientId = message.clientId;
        const result = options.onClientConnect?.(connection, message) ?? {
          clientId: message.clientId,
          sessionId: message.sessionId,
          currentSeq: message.streamLastSeq ?? message.lastSeq ?? asSeq(0),
        };
        connection.send({
          type: "connected",
          clientId: result.clientId,
          sessionId: result.sessionId,
          currentSeq: result.currentSeq,
          deviceId: result.deviceId,
          deviceDisplayName: result.deviceDisplayName,
          projectSlug: result.projectSlug,
        });
        return;
      }

      const response = options.onClientMessage(connection, message);
      if (response) {
        connection.send(response);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeWebSocketServer(server);
    throw new Error("remote daemon WebSocket server did not expose a TCP address");
  }
  const host = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  return {
    host: options.host,
    port: address.port,
    url: `ws://${host}:${address.port}`,
    close: () => closeWebSocketServer(server),
  };
};

export const startEmbeddedDaemonWebSocketServer = async (
  options: { daemon: EmbeddedDaemon; host: string; port: number; token: string },
): Promise<RemoteDaemonWebSocketServer> => {
  const connections = new WeakMap<RemoteDaemonWebSocketConnection, Connection>();
  const daemonConnectionFor = (webSocketConnection: RemoteDaemonWebSocketConnection, params?: ConnectParams): Connection => {
    const existing = connections.get(webSocketConnection);
    if (existing) {
      return existing;
    }
    const connection: Connection = {
      clientId: params?.clientId ?? asClientId("ws_unconnected"),
      emit: (daemonMessage) => webSocketConnection.send(daemonMessage),
    };
    connections.set(webSocketConnection, connection);
    webSocketConnection.socket.once("close", () => options.daemon.disconnect(connection));
    return connection;
  };

  return startRemoteDaemonWebSocketServer({
    host: options.host,
    port: options.port,
    token: options.token,
    onClientConnect: (webSocketConnection, params) => {
      const daemonConnection = daemonConnectionFor(webSocketConnection, params);
      daemonConnection.clientId = params.clientId;
      const result = options.daemon.connect(daemonConnection, params.sessionId);
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
        projectSlug: result.projectSlug,
      };
    },
    onClientMessage: (webSocketConnection, message) => {
      const daemonConnection = daemonConnectionFor(webSocketConnection);
      if (!daemonConnection.clientId) {
        return {
          type: "error",
          ok: false,
          code: "invalid_request",
          message: "websocket is not connected",
        };
      }
      void options.daemon.handleMessage(daemonConnection, message).catch((cause) => {
        webSocketConnection.send({
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
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
        projectSlug: result.projectSlug,
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

const closeWebSocketServer = (server: WebSocketServer): Promise<void> =>
  new Promise((resolve, reject) => {
    for (const client of server.clients) {
      client.close();
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });

export type RuntimeFactoryOptions = {
  cwd: string;
  config: ScorelConfig;
};

export type EmbeddedDaemonOptions = {
  sessionsDir: string;
  deviceId: DeviceId;
  deviceDisplayName?: string;
  projectSlug?: string;
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

type ResyncEventsResult = ClientRequestMap["resync_events"]["response"];

export class EmbeddedDaemon {
  readonly #sessionsDir: string;
  readonly #deviceId: DeviceId;
  readonly #deviceDisplayName: string | undefined;
  readonly #projectSlug: string | undefined;
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
    this.#deviceDisplayName = options.deviceDisplayName;
    this.#projectSlug = options.projectSlug;
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

  connect(connection: Connection, sessionId?: SessionId): ConnectResult {
    this.#assertStarted();
    connection.sessionId = sessionId;
    this.#connections.add(connection);
    if (sessionId) {
      void this.#appendDiagnostic(sessionId, "client_connected", {
        clientId: connection.clientId,
        deviceId: this.#deviceId,
        deviceDisplayName: this.#deviceDisplayName,
        projectSlug: this.#projectSlug,
      });
    }
    return {
      clientId: connection.clientId,
      sessionId,
      currentSeq: asSeq(sessionId ? (this.#seqs.get(sessionId) ?? 0) : 0),
      deviceId: this.#deviceId,
      deviceDisplayName: this.#deviceDisplayName,
      projectSlug: this.#projectSlug,
    };
  }

  disconnect(connection: Connection): void {
    if (connection.sessionId) {
      void this.#appendDiagnostic(connection.sessionId, "client_disconnected", {
        clientId: connection.clientId,
      });
    }
    this.#connections.delete(connection);
  }

  releaseSessionEventBuffer(sessionId: SessionId): void {
    this.#events.delete(sessionId);
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
        this.#respond(connection, message, await this.#resyncEvents(message.sessionId, {
          persistentLastSeq: message.persistentLastSeq ?? message.fromSeq,
          streamLastSeq: message.streamLastSeq ?? message.fromSeq,
        }));
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
        this.#respond(connection, message, {
          sessions: [...this.#sessions.values()].map((lane) => {
            const meta = lane.session.header.meta;
            return {
              sessionId: lane.session.header.sessionId,
              title: meta.title,
              model: meta.model,
              updatedAt: meta.updatedAt ?? meta.createdAt ?? lane.session.header.createdAt,
              currentSeq: lane.session.currentSeq,
            };
          }),
        });
        break;
    }
  }

  async #handleCreateSession(connection: Connection, request: ClientRequest<"create_session">): Promise<void> {
    const sessionId = request.sessionId ?? asSessionId(`ses_${this.#createId()}`);
    if (request.sessionId && (await this.#loadExistingLaneIfPresent(sessionId))) {
      await this.#appendDiagnostic(sessionId, "session_loaded", { clientId: connection.clientId });
      this.#respond(connection, request, { sessionId });
      return;
    }
    let lane: SessionLane;
    let created = true;
    try {
      lane = await this.#createLane(sessionId, request.meta ?? {});
    } catch (cause) {
      if (!request.sessionId || !isNodeErrorCode(cause, "EEXIST")) {
        throw cause;
      }
      lane = await this.#getLane(sessionId);
      created = false;
    }
    this.#sessions.set(sessionId, lane);
    if (created) {
      this.#events.set(sessionId, []);
      this.#seqs.set(sessionId, 0);
    }
    await this.#appendDiagnostic(sessionId, created ? "session_created" : "session_loaded", {
      clientId: connection.clientId,
      model: request.meta?.model,
    });
    this.#respond(connection, request, { sessionId });
  }

  async #handleLoadSession(connection: Connection, request: ClientRequest<"load_session">): Promise<void> {
    try {
      const lane = await this.#getLane(request.sessionId);
      await this.#appendDiagnostic(request.sessionId, "session_loaded", { clientId: connection.clientId });
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
      await this.#appendDiagnostic(request.sessionId, "send_message_started", {
        clientId: connection.clientId,
        activeLeafId: lane.session.activeLeafId,
      });
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

      await this.#appendDiagnostic(request.sessionId, "send_message_finished", {
        clientId: connection.clientId,
        userEventId,
        assistantEventId: state.finalAssistantEventId,
      });
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
        await this.#appendDiagnostic(lane.session.header.sessionId, "assistant_result", {
          clientId,
          stopReason: rawEvent.message.stopReason,
          textBlocks: countContentBlocks(rawEvent.message, "text"),
          toolCalls: countContentBlocks(rawEvent.message, "tool_call"),
          inputTokens: rawEvent.message.usage?.inputTokens,
          outputTokens: rawEvent.message.usage?.outputTokens,
          totalTokens: rawEvent.message.usage?.totalTokens,
        });
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
        void this.#appendDiagnostic(lane.session.header.sessionId, "runtime_turn_end", {
          clientId,
          stopReason: rawEvent.stopReason,
        });
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
        void this.#appendDiagnostic(lane.session.header.sessionId, "runtime_error", {
          clientId,
          message: rawEvent.error.message,
          stack: shortStack(rawEvent.error),
        });
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

  async #resyncEvents(
    sessionId: SessionId,
    anchors: { persistentLastSeq?: Seq; streamLastSeq?: Seq },
  ): Promise<ResyncEventsResult> {
    const currentSeq = asSeq(this.#seqs.get(sessionId) ?? 0);
    const persistentLastSeq = anchors.persistentLastSeq ?? asSeq(0);
    const streamLastSeq = anchors.streamLastSeq ?? persistentLastSeq;

    if (Number(streamLastSeq) >= Number(currentSeq)) {
      const result: ResyncEventsResult = {
        events: [],
        throughSeq: currentSeq,
        mode: "stream_resume",
      };
      await this.#appendDiagnostic(sessionId, "resync_events", {
        mode: result.mode,
        persistentLastSeq,
        streamLastSeq,
        throughSeq: result.throughSeq,
        eventCount: result.events.length,
      });
      return result;
    }

    const buffered = this.#eventsAfter(sessionId, streamLastSeq);
    if (hasContinuousCoverage(buffered, Number(streamLastSeq) + 1)) {
      const result: ResyncEventsResult = {
        events: buffered,
        throughSeq: buffered.at(-1)?.seq ?? streamLastSeq,
        mode: "stream_resume",
      };
      await this.#appendDiagnostic(sessionId, "resync_events", {
        mode: result.mode,
        persistentLastSeq,
        streamLastSeq,
        throughSeq: result.throughSeq,
        eventCount: result.events.length,
      });
      return result;
    }

    const lane = await this.#getLane(sessionId);
    const events = [...lane.session.tree].filter((event) => Number(event.seq) > Number(persistentLastSeq));
    const throughSeq = events.at(-1)?.seq ?? persistentLastSeq;
    const mode: ResyncEventsResult["mode"] =
      Number(persistentLastSeq) === 0 && Number(streamLastSeq) === 0 ? "full_reload" : "persistent_fallback";
    const result: ResyncEventsResult = {
      events,
      throughSeq,
      mode,
      gapFromSeq: asSeq(Number(streamLastSeq) + 1),
      gapToSeq: currentSeq,
    };
    await this.#appendDiagnostic(sessionId, "resync_events", {
      mode: result.mode,
      persistentLastSeq,
      streamLastSeq,
      throughSeq: result.throughSeq,
      eventCount: result.events.length,
      gapFromSeq: result.gapFromSeq,
      gapToSeq: result.gapToSeq,
    });
    return result;
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

  async #loadExistingLaneIfPresent(sessionId: SessionId): Promise<boolean> {
    if (this.#sessions.has(sessionId)) {
      return true;
    }
    try {
      await this.#getLane(sessionId);
      return true;
    } catch (cause) {
      if (isNodeErrorCode(cause, "ENOENT")) {
        return false;
      }
      throw cause;
    }
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

  async #appendDiagnostic(sessionId: SessionId, event: string, fields: Record<string, unknown> = {}): Promise<void> {
    const line = formatDiagnosticLine({
      ts: this.#now(),
      level: event.endsWith("_error") || event.endsWith("_failed") ? "error" : "info",
      event,
      sessionId,
      ...fields,
    });
    await mkdir(this.#sessionsDir, { recursive: true });
    await appendFile(sessionLogFilePath(this.#sessionsDir, sessionId), `${line}\n`, "utf8");
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
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
        projectSlug: result.projectSlug,
      });
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
        projectSlug: result.projectSlug,
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

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

const hasContinuousCoverage = (events: ScorelEvent[], expectedFirstSeq: number): boolean => {
  if (events.length === 0) {
    return false;
  }
  let expected = expectedFirstSeq;
  for (const event of events) {
    if (Number(event.seq) !== expected) {
      return false;
    }
    expected += 1;
  }
  return true;
};

const countContentBlocks = (message: ScorelMessage, type: string): number =>
  message.content.filter((block) => block.type === type).length;

const shortStack = (error: Error): string | undefined => error.stack?.split("\n").slice(0, 3).join(" | ");

const formatDiagnosticLine = (fields: Record<string, unknown>): string =>
  Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`)
    .join(" ");

const formatDiagnosticValue = (value: unknown): string => {
  const text = typeof value === "string" ? value : String(value);
  return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
};
