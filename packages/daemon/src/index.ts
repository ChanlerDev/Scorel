import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

import { listDirectories as browseDirectories } from "./projects/directories.js";
import { ProjectRegistry, ProjectRegistryError } from "./projects/registry.js";
import { listSessionSummaries } from "./projects/sessions.js";

import {
  ScorelRuntime,
  buildContext,
  buildInstructionSnapshot,
  corePackageName,
  createCodingTools,
  createSkillTool,
  diffSkillIndex,
  createPiAiProvider,
  createSession,
  hasSkillIndexDelta,
  listAvailableModels,
  listProviderConnections,
  listProviderModels,
  loadScorelConfig,
  loadScorelConfigProfile,
  loadSession,
  renderSkillDelta,
  renderSkillListing,
  renderSystemPrompt,
  renderModelProfileConfig,
  resolveModelSelection,
  resolvePiAiModel,
  scanSkillIndex,
  sessionLogFilePath,
  scorelSessionsDir,
  type ScorelConfig,
  type ScorelConfigProfile,
  type JsonlSession,
  type RawRuntimeEvent,
} from "@scorel/core";
import {
  asClientId,
  asDeviceId,
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
  type CreateSessionMeta,
  type DaemonTransport,
  type DaemonMessage,
  type DeviceId,
  type EventId,
  type AvailableModelSummary,
  type HostProject,
  type PersistentEvent,
  type ProjectId,
  type QueueItem,
  type QueueName,
  type ScorelEvent,
  type SelectedModelSummary,
  type ProviderCatalogModelSummary,
  type ProviderConnectionSummary,
  type ProviderModelSummary,
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
export type ScorelHostTransport = DaemonTransport;
export { loadScorelConfig, loadScorelConfigProfile, scorelSessionsDir, type ScorelConfig };
export {
  authorizeRelayClient,
  hostDeviceIdentityPath,
  hostRelayAuthPath,
  isRelayClientAuthorized,
  loadOrCreateHostDeviceIdentity,
  readHostDeviceIdentity,
  readHostRelayAuth,
  type HostDeviceIdentity,
  type HostRelayAuthFile,
} from "./relay/auth.js";
export { redeemRelayPair, type RedeemRelayPairOptions, type RedeemRelayPairResult } from "./relay/pair.js";
export { startHostRelayClient, type HostRelayClient, type HostRelayClientOptions } from "./relay/host-client.js";

/**
 * On-disk shape of `~/.scorel/daemon.json` (S0043). The unix-socket era schema
 * (`socketPath` + `pid`-only) is removed; a single WS daemon owns the state
 * file across restarts. `token` persists so subsequent `serve` runs reuse it
 * without operator intervention; `stoppedAt` flips from `null` → epoch on
 * graceful shutdown so `daemonStateLiveness` can distinguish a clean stop
 * from a crashed/orphan pid.
 */
export type LocalDaemonState = {
  host: string;
  port: number;
  wsUrl: string;
  token: string;
  pid: number;
  startedAt: number;
  stoppedAt: number | null;
};

export type LocalDaemonStateOptions = {
  stateDir: string;
};

export type CreateLocalDaemonStateOptions = LocalDaemonStateOptions & LocalDaemonState;

export type DaemonStateLiveness = "running" | "stopped" | "orphan";

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
  const state: LocalDaemonState = {
    host: options.host,
    port: options.port,
    wsUrl: options.wsUrl,
    token: options.token,
    pid: options.pid,
    startedAt: options.startedAt,
    stoppedAt: options.stoppedAt,
  };
  await mkdir(options.stateDir, { recursive: true });
  await writeFile(localDaemonStateFile(options.stateDir), `${JSON.stringify(state, null, 2)}\n`);
  return state;
};

export const readLocalDaemonState = async (options: LocalDaemonStateOptions): Promise<LocalDaemonState | null> => {
  try {
    const raw = JSON.parse(await readFile(localDaemonStateFile(options.stateDir), "utf8")) as Partial<LocalDaemonState>;
    if (
      typeof raw.host !== "string" ||
      typeof raw.port !== "number" ||
      typeof raw.wsUrl !== "string" ||
      typeof raw.token !== "string" ||
      typeof raw.pid !== "number" ||
      typeof raw.startedAt !== "number" ||
      !(raw.stoppedAt === null || typeof raw.stoppedAt === "number")
    ) {
      return null;
    }
    return {
      host: raw.host,
      port: raw.port,
      wsUrl: raw.wsUrl,
      token: raw.token,
      pid: raw.pid,
      startedAt: raw.startedAt,
      stoppedAt: raw.stoppedAt,
    };
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

/**
 * Partial in-place update used by `serve` graceful-shutdown to flip
 * `stoppedAt` from `null` to a timestamp without disturbing other fields.
 * Silently no-ops if the state file disappeared (e.g. operator ran `reset`
 * concurrently) — flipping `stoppedAt` is a best-effort marker.
 */
export const markDaemonStopped = async (
  options: LocalDaemonStateOptions & { stoppedAt: number },
): Promise<void> => {
  const state = await readLocalDaemonState({ stateDir: options.stateDir });
  if (!state) {
    return;
  }
  await writeFile(
    localDaemonStateFile(options.stateDir),
    `${JSON.stringify({ ...state, stoppedAt: options.stoppedAt }, null, 2)}\n`,
  );
};

/**
 * Classify a state file's owning process. The `pid` field is only meaningful
 * paired with `stoppedAt`: a dead pid + null `stoppedAt` is the orphan case
 * that `serve` is allowed to overwrite, while a dead pid + populated
 * `stoppedAt` is the normal "previous run exited" case.
 *
 * `process.kill(pid, 0)` on POSIX returns truthy for any process the caller
 * could signal — including unrelated processes that happen to have inherited
 * the pid after wraparound. The trade-off is documented in the spec; users
 * can always `scorel daemon reset` if they get a false-positive after a
 * reboot.
 */
export const daemonStateLiveness = (
  state: LocalDaemonState,
  options: { isPidAlive?: (pid: number) => boolean } = {},
): DaemonStateLiveness => {
  const isAlive = options.isPidAlive ?? defaultIsPidAlive;
  const alive = isAlive(state.pid);
  if (alive && state.stoppedAt === null) {
    return "running";
  }
  if (!alive && state.stoppedAt === null) {
    return "orphan";
  }
  return "stopped";
};

const defaultIsPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EPERM") {
      // Pid exists but we can't signal it (different user). Treat as alive.
      return true;
    }
    return false;
  }
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
        const result: ConnectResult = options.onClientConnect?.(connection, message) ?? {
          clientId: message.clientId,
          sessionId: message.sessionId,
          currentSeq: message.streamLastSeq ?? message.lastSeq ?? asSeq(0),
          deviceId: asDeviceId("device_unknown"),
        };
        connection.send({
          type: "connected",
          clientId: result.clientId,
          sessionId: result.sessionId,
          currentSeq: result.currentSeq,
          deviceId: result.deviceId,
          deviceDisplayName: result.deviceDisplayName,
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

export const startScorelHostWebSocketServer = async (
  options: { hostService: ScorelHost; host: string; port: number; token: string },
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
    webSocketConnection.socket.once("close", () => options.hostService.disconnect(connection));
    return connection;
  };

  return startRemoteDaemonWebSocketServer({
    host: options.host,
    port: options.port,
    token: options.token,
    onClientConnect: (webSocketConnection, params) => {
      const daemonConnection = daemonConnectionFor(webSocketConnection, params);
      daemonConnection.clientId = params.clientId;
      const result = options.hostService.connect(daemonConnection, params.sessionId);
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
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
      void options.hostService.handleMessage(daemonConnection, message).catch((cause) => {
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
  modelSelection?: { modelId?: string; role?: "primary" | "standard" | "auxiliary" };
  includeTools?: boolean;
};

export type ScorelHostOptions = {
  sessionsDir: string;
  projectsPath: string;
  deviceId: DeviceId;
  deviceDisplayName?: string;
  modelProfile?: ScorelConfig;
  loadConfig?: (options: { project: HostProject }) => Promise<ScorelConfig>;
  loadConfigProfile?: (options: { project: HostProject }) => Promise<ScorelConfigProfile>;
  createRuntime: (options: { sessionId: SessionId; project: HostProject; selectedModel?: SelectedModelSummary; purpose: "chat" | "title" }) => Promise<ScorelRuntime>;
  now?: () => number;
  createId?: () => string;
};

export const createRealRuntime = (options: RuntimeFactoryOptions): ScorelRuntime => {
  const selection = resolveModelSelection(options.config, options.modelSelection);
  const model = resolvePiAiModel(selection.config);
  const runtime = new ScorelRuntime({
    provider: createPiAiProvider({
      model,
      apiKey: selection.config.apiKey,
    }),
  });
  if (options.includeTools !== false) {
    for (const tool of createCodingTools({ cwd: options.cwd, contextWindow: model.contextWindow })) {
      runtime.registerTool(tool);
    }
  }
  return runtime;
};

type SessionLane = {
  session: JsonlSession;
  project: HostProject;
  runtime: ScorelRuntime;
  queue: Promise<unknown>;
  followUpWaiters: Map<string, { connection: Connection; request: ClientRequest<"send_message"> }>;
};

type PersistentEventInput =
  | Omit<Extract<PersistentEvent, { type: "user_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "assistant_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "tool_result" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "session_title_updated" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "instruction_snapshot" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "harness_item" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "queue_update" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "skill_index_snapshot" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "skill_index_delta" }>, "seq">;

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

export class ScorelHost {
  readonly #sessionsDir: string;
  readonly #deviceId: DeviceId;
  readonly #deviceDisplayName: string | undefined;
  readonly #modelProfile: ScorelConfig | undefined;
  readonly #loadConfig: ((options: { project: HostProject }) => Promise<ScorelConfig>) | undefined;
  readonly #loadConfigProfile: ((options: { project: HostProject }) => Promise<ScorelConfigProfile>) | undefined;
  readonly #createRuntime: ScorelHostOptions["createRuntime"];
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #sessions = new Map<SessionId, SessionLane>();
  readonly #connections = new Set<Connection>();
  readonly #events = new Map<SessionId, ScorelEvent[]>();
  readonly #seqs = new Map<SessionId, number>();
  readonly #registry: ProjectRegistry;
  #started = false;

  constructor(options: ScorelHostOptions) {
    this.#sessionsDir = options.sessionsDir;
    this.#deviceId = options.deviceId;
    this.#deviceDisplayName = options.deviceDisplayName;
    this.#modelProfile = options.modelProfile;
    this.#loadConfig = options.loadConfig;
    this.#loadConfigProfile = options.loadConfigProfile;
    this.#createRuntime = options.createRuntime;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#registry = new ProjectRegistry({
      sessionsDir: this.#sessionsDir,
      projectsPath: options.projectsPath,
      createId: this.#createId,
      now: this.#now,
    });
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
      });
    }
    return {
      clientId: connection.clientId,
      sessionId,
      currentSeq: asSeq(sessionId ? (this.#seqs.get(sessionId) ?? 0) : 0),
      deviceId: this.#deviceId,
      deviceDisplayName: this.#deviceDisplayName,
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
    try {
      await this.#handleMessage(connection, message);
    } catch (cause) {
      if ("requestId" in message) {
        connection.emit({
          type: "error",
          requestId: message.requestId,
          ok: false,
          code: wireErrorCode(cause),
          message: cause instanceof Error ? cause.message : String(cause),
        });
        return;
      }
      throw cause;
    }
  }

  async listDirectories(path?: string) {
    const listing = await browseDirectories(path);
    await this.#appendHostDiagnostic("directory_listed", { path: listing.path });
    return listing;
  }

  async registerProject(workDir: string): Promise<HostProject> {
    const project = await this.#registry.register(workDir);
    await this.#appendHostDiagnostic("project_registered", {
      projectId: project.projectId,
      workDir: project.workDir,
    });
    return project;
  }

  async listProjects(): Promise<HostProject[]> {
    return this.#registry.list();
  }

  async removeProject(projectId: ProjectId): Promise<boolean> {
    const project = await this.#registry.require(projectId);
    const removed = await this.#registry.remove(projectId);
    await this.#appendHostDiagnostic("project_removed", {
      projectId,
      workDir: project.workDir,
    });
    return removed;
  }

  async #handleMessage(connection: Connection, message: ClientMessage): Promise<void> {
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
      case "rewrite_queue":
        await this.#handleRewriteQueue(connection, message);
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
      case "list_sessions": {
        const sessions = await listSessionSummaries(
          this.#sessionsDir,
          { projectId: message.projectId, limit: message.limit },
          this.#sessionSummaryOverrides(),
        );
        this.#respond(connection, message, { sessions });
        break;
      }
      case "list_projects": {
        this.#respond(connection, message, { projects: await this.listProjects() });
        break;
      }
      case "list_models": {
        this.#respond(connection, message, await this.#listModels(message.projectId));
        break;
      }
      case "upsert_model_profile": {
        this.#respond(connection, message, await this.#handleUpsertModelProfile(message));
        break;
      }
      case "fetch_provider_models": {
        this.#respond(connection, message, { models: await this.#fetchProviderModels(message.projectId, message.providerId) });
        break;
      }
      case "list_directories": {
        this.#respond(connection, message, await this.listDirectories(message.path));
        break;
      }
      case "register_project": {
        this.#respond(connection, message, { project: await this.registerProject(message.workDir) });
        break;
      }
      case "remove_project": {
        this.#respond(connection, message, {
          projectId: message.projectId,
          removed: await this.removeProject(message.projectId),
        });
        break;
      }
      case "cancel":
        await this.#handleCancel(connection, message);
        break;
    }
  }

  async #handleCreateSession(connection: Connection, request: ClientRequest<"create_session">): Promise<void> {
    const sessionId = request.sessionId ?? asSessionId(`ses_${this.#createId()}`);
    const project = await this.#resolveProject(sessionId, request.meta.projectId);
    if (request.sessionId && (await this.#loadExistingLaneIfPresent(sessionId))) {
      if (this.#sessions.get(sessionId)?.project.projectId !== project.projectId) {
        throw new ProjectRegistryError("conflict", `Session ${sessionId} belongs to another project`);
      }
      await this.#appendDiagnostic(sessionId, "session_loaded", { clientId: connection.clientId });
      this.#respond(connection, request, { sessionId });
      return;
    }
    let lane: SessionLane;
    let created = true;
    try {
      lane = await this.#createLane(sessionId, request.meta, project);
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
      projectId: lane.project.projectId,
      workDir: lane.project.workDir,
      model: request.meta.model,
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
    if (lane.runtime.running) {
      const runningBehavior = request.options?.runningBehavior ?? "follow_up";
      if (runningBehavior === "steer") {
        await this.#enqueueSteer(lane, connection, request);
        return;
      }
      await this.#enqueueFollowUp(lane, connection, request);
      return;
    }

    lane.queue = lane.queue.then(async () => {
      await this.#drainFollowUps(lane);
      await this.#runUserTurn(lane, connection.clientId, {
        content: normalizeContent(request.content),
        parentId: request.options?.parentId,
        source: "user",
        onComplete: (result) => this.#respond(connection, request, { ...result, status: "completed" }),
      });
      await this.#drainFollowUps(lane);
    });

    await lane.queue;
  }

  async #handleRewriteQueue(connection: Connection, request: ClientRequest<"rewrite_queue">): Promise<void> {
    const lane = await this.#getLane(request.sessionId);
    await this.#appendQueueRewrite(lane, request.queue, request.items, {
      clientId: connection.clientId,
      anchorEventId: lane.session.activeLeafId,
    });
    await this.#appendDiagnostic(request.sessionId, "queue_rewritten", {
      clientId: connection.clientId,
      queue: request.queue,
      queueSize: request.items.length,
    });
    this.#respond(connection, request, {
      sessionId: request.sessionId,
      queue: request.queue,
      items: request.items,
    });
  }

  async #runUserTurn(
    lane: SessionLane,
    clientId: ClientId,
    input: {
      content: ScorelMessage["content"];
      parentId?: EventId | null;
      source: "user" | "follow_up";
      queueItemId?: string;
      onComplete?: (result: Required<Pick<ClientRequestMap["send_message"]["response"], "userEventId" | "assistantEventId">>) => void;
    },
  ): Promise<ClientRequestMap["send_message"]["response"]> {
    const sessionId = lane.session.header.sessionId;
    await this.#appendDiagnostic(sessionId, "send_message_started", {
      clientId,
      activeLeafId: lane.session.activeLeafId,
      source: input.source,
    });
    const instructionSnapshot = await this.#ensureInstructionSnapshot(lane, clientId);
    await this.#syncSkillIndex(lane, clientId);
    const userEventId = asEventId(this.#createId());
    const userEvent = await this.#appendPersistent(lane, {
      type: "user_message",
      id: userEventId,
      parentId: input.parentId === undefined ? lane.session.activeLeafId : input.parentId,
      sessionId,
      clientId,
      ts: this.#now(),
      message: {
        role: "user",
        content: input.content,
        ...(input.source === "follow_up"
          ? { meta: { source: "follow_up", queueItemId: input.queueItemId } }
          : {}),
      },
    }) as Extract<PersistentEvent, { type: "user_message" }>;
    const firstAssistantEventId = asEventId(this.#createId());
    const state: RuntimeEventState = {
      parentId: userEvent.id,
      assistantEventId: firstAssistantEventId,
      finalAssistantEventId: firstAssistantEventId,
    };

    for await (const rawEvent of lane.runtime.executeTurn(
      buildContext(lane.session.tree, userEvent.id),
      renderSystemPrompt(instructionSnapshot),
      {
        refreshContext: async () => {
          await this.#consumeSteer(lane, clientId, state);
          return buildContext(lane.session.tree, lane.session.activeLeafId ?? state.parentId);
        },
      },
    )) {
      await this.#handleRuntimeEvent(lane, clientId, state, rawEvent);
    }

    const result = { userEventId, assistantEventId: state.finalAssistantEventId };
    await this.#appendDiagnostic(sessionId, "send_message_finished", {
      clientId,
      userEventId,
      assistantEventId: state.finalAssistantEventId,
      source: input.source,
    });
    input.onComplete?.(result);
    const generatedTitle = await this.#maybeGenerateSessionTitle(lane, clientId, userEvent).catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      void this.#appendDiagnostic(sessionId, "session_title_generation_failed", {
        clientId,
        message: error.message,
        stack: shortStack(error),
      });
      return undefined;
    });
    if (generatedTitle) {
      await this.#appendPersistent(lane, {
        type: "session_title_updated",
        id: asEventId(this.#createId()),
        parentId: null,
        sessionId,
        clientId,
        ts: this.#now(),
        title: generatedTitle.title,
        source: "model",
        model: generatedTitle.model,
        derivedFrom: {
          eventId: userEvent.id,
          seq: userEvent.seq,
        },
      });
      await this.#appendDiagnostic(sessionId, "session_title_generated", {
        clientId,
        title: generatedTitle.title,
        modelId: generatedTitle.model.modelId,
      });
    }
    return { ...result, status: "completed" };
  }

  async #maybeGenerateSessionTitle(
    lane: SessionLane,
    clientId: ClientId,
    userEvent: Extract<PersistentEvent, { type: "user_message" }>,
  ): Promise<{ title: string; model: SelectedModelSummary } | undefined> {
    if (lane.session.header.meta.title?.trim()) {
      return undefined;
    }
    const text = inputText(userEvent.message).trim();
    if (!text) {
      return undefined;
    }
    let userMessages = 0;
    for (const event of lane.session.tree) {
      if (event.type === "session_title_updated") {
        return undefined;
      }
      if (event.type === "user_message") {
        userMessages += 1;
      }
    }
    if (userMessages !== 1) {
      return undefined;
    }
    const selectedModel = await this.#selectedModelFromMeta(
      { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
      lane.project,
    );
    if (!selectedModel) {
      return undefined;
    }
    const runtime = await this.#createRuntime({ sessionId: lane.session.header.sessionId, project: lane.project, selectedModel, purpose: "title" });
    let rawTitle = "";
    for await (const rawEvent of runtime.executeTurn(
      [
        {
          role: "user",
          content: [{ type: "text", text: text.slice(0, 4_000) }],
        },
      ],
      "Generate a concise title for this chat. Return only the title text. Do not use tools. Use 4 to 8 words, no quotes, no trailing punctuation.",
      {},
    )) {
      if (rawEvent.type === "text_delta") {
        rawTitle += rawEvent.delta;
      } else if (rawEvent.type === "message_end") {
        rawTitle = assistantText(rawEvent.message) || rawTitle;
      } else if (rawEvent.type === "error") {
        throw rawEvent.error;
      }
    }
    const title = sanitizeSessionTitle(rawTitle);
    if (!title) {
      return undefined;
    }
    await this.#appendDiagnostic(lane.session.header.sessionId, "session_title_model_used", {
      clientId,
      modelId: selectedModel.modelId,
      role: selectedModel.role,
    });
    return { title, model: selectedModel };
  }

  async #enqueueFollowUp(
    lane: SessionLane,
    connection: Connection,
    request: ClientRequest<"send_message">,
  ): Promise<void> {
    const now = this.#now();
    const item: QueueItem = {
      id: this.#createId(),
      content: normalizeContent(request.content),
      createdAt: now,
      updatedAt: now,
      clientId: connection.clientId,
    };
    lane.followUpWaiters.set(item.id, { connection, request });
    await this.#appendQueueRewrite(lane, "follow_up", [...lane.session.tree.controlState.queues.follow_up, item], {
      clientId: connection.clientId,
      anchorEventId: lane.session.activeLeafId,
    });
    await this.#appendDiagnostic(lane.session.header.sessionId, "follow_up_queued", {
      clientId: connection.clientId,
      queueItemId: item.id,
      queueSize: lane.session.tree.controlState.queues.follow_up.length,
    });
  }

  async #enqueueSteer(
    lane: SessionLane,
    connection: Connection,
    request: ClientRequest<"send_message">,
  ): Promise<void> {
    const now = this.#now();
    const item: QueueItem = {
      id: this.#createId(),
      content: normalizeContent(request.content),
      createdAt: now,
      updatedAt: now,
      clientId: connection.clientId,
    };
    await this.#appendQueueRewrite(lane, "steer", [...lane.session.tree.controlState.queues.steer, item], {
      clientId: connection.clientId,
      anchorEventId: lane.session.activeLeafId,
    });
    await this.#appendDiagnostic(lane.session.header.sessionId, "steer_queued", {
      clientId: connection.clientId,
      queueItemId: item.id,
      queueSize: lane.session.tree.controlState.queues.steer.length,
    });
    this.#respond(connection, request, {
      status: "queued",
      queue: "steer",
      queueItemId: item.id,
    });
  }

  async #drainFollowUps(lane: SessionLane): Promise<void> {
    while (lane.session.tree.controlState.queues.follow_up.length > 0) {
      const item = lane.session.tree.controlState.queues.follow_up[0]!;
      const remaining = lane.session.tree.controlState.queues.follow_up.slice(1);
      await this.#appendQueueRewrite(lane, "follow_up", remaining, {
        clientId: item.clientId,
        anchorEventId: lane.session.activeLeafId,
      });
      const waiter = lane.followUpWaiters.get(item.id);
      lane.followUpWaiters.delete(item.id);
      await this.#runUserTurn(lane, item.clientId, {
        content: item.content,
        parentId: lane.session.activeLeafId,
        source: "follow_up",
        queueItemId: item.id,
        onComplete: waiter
          ? (result) => this.#respond(waiter.connection, waiter.request, { ...result, status: "completed" })
          : undefined,
      });
    }
  }

  async #consumeSteer(lane: SessionLane, clientId: ClientId, state: RuntimeEventState): Promise<void> {
    const item = lane.session.tree.controlState.queues.steer[0];
    if (!item) {
      return;
    }
    await this.#appendQueueRewrite(lane, "steer", lane.session.tree.controlState.queues.steer.slice(1), {
      clientId,
      anchorEventId: state.parentId,
    });
    const content = item.content
      .filter((block): block is Extract<ScorelMessage["content"][number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const harnessEvent = await this.#appendPersistent(lane, {
      type: "harness_item",
      id: asEventId(this.#createId()),
      parentId: state.parentId,
      sessionId: lane.session.header.sessionId,
      clientId: item.clientId,
      ts: this.#now(),
      item: {
        kind: "steer",
        origin: "user",
        content,
        visibility: "display",
        data: { queueItemId: item.id },
      },
    });
    state.parentId = harnessEvent.id;
  }

  async #appendQueueRewrite(
    lane: SessionLane,
    queue: QueueName,
    items: QueueItem[],
    options: { clientId: ClientId; anchorEventId: EventId | null },
  ): Promise<void> {
    await this.#appendPersistent(lane, {
      type: "queue_update",
      id: asEventId(this.#createId()),
      parentId: null,
      sessionId: lane.session.header.sessionId,
      clientId: options.clientId,
      ts: this.#now(),
      queue,
      operation: "rewrite",
      items,
      anchorEventId: options.anchorEventId,
    });
  }

  async #handleCancel(connection: Connection, request: ClientRequest<"cancel">): Promise<void> {
    try {
      const lane = await this.#getLane(request.sessionId);
      const cancelled = lane.runtime.running;
      lane.runtime.cancel();
      await this.#appendDiagnostic(request.sessionId, "cancel_requested", {
        clientId: connection.clientId,
        cancelled,
      });
      this.#respond(connection, request, {
        sessionId: request.sessionId,
        cancelled,
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

  #sessionSummaryOverrides(): Map<string, { currentSeq?: number; updatedAt?: number }> {
    const overrides = new Map<string, { currentSeq?: number; updatedAt?: number }>();
    for (const [sessionId, currentSeq] of this.#seqs.entries()) {
      overrides.set(String(sessionId), { currentSeq });
    }
    return overrides;
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

  async #ensureInstructionSnapshot(lane: SessionLane, clientId: ClientId) {
    const existing = lane.session.tree.controlState.instructionSnapshot;
    if (existing) {
      return existing;
    }

    const snapshot = await buildInstructionSnapshot({
      cwd: lane.project.workDir,
      now: this.#now,
    });
    await this.#appendPersistent(lane, {
      type: "instruction_snapshot",
      id: asEventId(this.#createId()),
      parentId: null,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      snapshot,
    });
    await this.#appendDiagnostic(lane.session.header.sessionId, "instruction_snapshot_created", {
      clientId,
      sections: snapshot.sections.length,
    });
    return snapshot;
  }

  async #syncSkillIndex(lane: SessionLane, clientId: ClientId): Promise<void> {
    const entries = await scanSkillIndex({ cwd: lane.project.workDir });
    if (!lane.session.tree.controlState.skillIndexInitialized) {
      await this.#appendPersistent(lane, {
        type: "skill_index_snapshot",
        id: asEventId(this.#createId()),
        parentId: null,
        sessionId: lane.session.header.sessionId,
        clientId,
        ts: this.#now(),
        anchorEventId: lane.session.activeLeafId,
        entries,
      });
      await this.#appendSkillHarness(lane, clientId, "skill_listing", renderSkillListing(entries));
      return;
    }

    const delta = diffSkillIndex(lane.session.tree.controlState.skillIndex, entries);
    if (!hasSkillIndexDelta(delta)) {
      return;
    }
    await this.#appendPersistent(lane, {
      type: "skill_index_delta",
      id: asEventId(this.#createId()),
      parentId: null,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      anchorEventId: lane.session.activeLeafId,
      added: delta.added,
      changed: delta.changed,
      removed: delta.removed,
    });
    await this.#appendSkillHarness(lane, clientId, "skill_delta", renderSkillDelta(delta));
  }

  async #appendSkillHarness(
    lane: SessionLane,
    clientId: ClientId,
    kind: "skill_listing" | "skill_delta",
    content: string,
  ): Promise<void> {
    await this.#appendPersistent(lane, {
      type: "harness_item",
      id: asEventId(this.#createId()),
      parentId: lane.session.activeLeafId,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      item: {
        kind,
        origin: "system",
        content,
        visibility: "hidden",
      },
    });
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
    // Cold attach: a client connected to a session id we have not yet loaded
    // into memory (typical when WebUI opens a historical session that lives
    // only on disk). Load the lane so #seqs reflects the persisted tail
    // before deciding whether to short-circuit on stream_resume — otherwise
    // currentSeq stays at 0 and the early return strands the caller with an
    // empty event list.
    if (!this.#seqs.has(sessionId)) {
      try {
        await this.#getLane(sessionId);
      } catch {
        // Session id unknown to disk; fall through with currentSeq=0.
      }
    }
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
    const project = await this.#resolveProject(sessionId, loaded.header.meta.projectId);
    const selectedModel = await this.#selectedModelFromMeta(loaded.header.meta, project);
    const runtime = await this.#createRuntime({ sessionId, project, selectedModel, purpose: "chat" });
    await this.#appendDiagnostic(sessionId, "runtime_created", {
      projectId: project.projectId,
      workDir: project.workDir,
      selectedModelId: selectedModel?.modelId,
    });
    const lane = {
      session: loaded,
      project,
      runtime,
      queue: Promise.resolve(),
      followUpWaiters: new Map(),
    };
    this.#registerLaneTools(lane);
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

  async #createLane(sessionId: SessionId, meta: CreateSessionMeta, project: HostProject): Promise<SessionLane> {
    const selectedModel = await this.#selectedModelFromMeta(meta, project);
    const session = await createSession({
      sessionsDir: this.#sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId: this.#deviceId,
        createdAt: this.#now(),
        meta: {
          ...meta,
          ...(selectedModel
            ? {
                model: selectedModel.displayName,
                selectedModel,
              }
            : {}),
        },
      },
    });
    const runtime = await this.#createRuntime({ sessionId, project, selectedModel, purpose: "chat" });
    await this.#appendDiagnostic(sessionId, "runtime_created", {
      projectId: project.projectId,
      workDir: project.workDir,
      selectedModelId: selectedModel?.modelId,
    });
    const lane = {
      session,
      project,
      runtime,
      queue: Promise.resolve(),
      followUpWaiters: new Map(),
    };
    this.#registerLaneTools(lane);
    return lane;
  }

  #registerLaneTools(lane: SessionLane): void {
    lane.runtime.registerTool(
      createSkillTool({
        getEntry: (name) => lane.session.tree.controlState.skillIndex[name],
        listNames: () => Object.keys(lane.session.tree.controlState.skillIndex).sort(),
      }),
    );
  }

  async #listModels(projectId?: ProjectId): Promise<{
    providers: ProviderConnectionSummary[];
    providerModels: ProviderModelSummary[];
    models: AvailableModelSummary[];
    roles: Record<"primary" | "standard" | "auxiliary", string>;
    warnings?: string[];
  }> {
    let config: ScorelConfig | ScorelConfigProfile | undefined;
    try {
      config = await this.#configProfileForProject(projectId);
    } catch (cause) {
      if (!isMissingConfigError(cause)) {
        throw cause;
      }
      config = undefined;
    }
    if (!config) {
      return {
        providers: [],
        providerModels: [],
        models: [],
        roles: {
          primary: "",
          standard: "",
          auxiliary: "",
        },
      };
    }
    const configWarnings = "warnings" in config ? config.warnings : undefined;
    return {
      providers: listProviderConnections(config),
      providerModels: listProviderModels(config),
      models: listAvailableModels(config),
      roles: config.modelProfile.roles,
      ...(configWarnings ? { warnings: configWarnings } : {}),
    };
  }

  async #handleUpsertModelProfile(
    request: ClientRequest<"upsert_model_profile">,
  ): Promise<{
    providers: ProviderConnectionSummary[];
    providerModels: ProviderModelSummary[];
    models: AvailableModelSummary[];
    roles: Record<"primary" | "standard" | "auxiliary", string>;
    warnings?: string[];
  }> {
    const project = await this.#registry.require(request.projectId);
    const configPath = join(project.workDir, ".scorel", "config.toml");
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(join(project.workDir, ".scorel"), { recursive: true });
    await writeFile(
      configPath,
      renderModelProfileConfig({
        providerId: request.providerId,
        providerType: request.providerType,
        provider: request.provider,
        apiKeyEnv: request.apiKeyEnv,
        apiKey: request.apiKey,
        api: request.api,
        baseUrl: request.baseUrl,
        modelId: request.modelId,
        providerModelKey: request.providerModelKey,
        availableModelId: request.availableModelId,
        addToAvailable: request.addToAvailable,
        removeAvailableModelId: request.removeAvailableModelId,
        providerModelId: request.providerModelId,
        displayName: request.displayName,
        contextWindow: request.contextWindow,
        maxTokens: request.maxTokens,
        reasoning: request.reasoning,
        supportsDeveloperRole: request.supportsDeveloperRole,
        supportsImageInput: request.supportsImageInput,
        roles: request.roles,
        existingConfigText,
      }),
      "utf8",
    );
    await this.#appendHostDiagnostic("model_profile_upserted", {
      projectId: project.projectId,
      workDir: project.workDir,
      providerId: request.providerId,
      modelId: request.modelId,
    });
    return this.#listModels(project.projectId);
  }

  async #fetchProviderModels(projectId: ProjectId, providerId: string): Promise<ProviderCatalogModelSummary[]> {
    const project = await this.#registry.require(projectId);
    const config = await loadScorelConfigProfile({ cwd: project.workDir, includeSecrets: true });
    if (!config) {
      throw new Error("Model profile config is not configured");
    }
    const provider = config.providers[providerId];
    if (!provider) {
      throw new Error(`Provider is not configured: ${providerId}`);
    }
    if (provider.type !== "custom" || (provider.api !== "openai-completions" && provider.api !== "openai-responses")) {
      throw new Error("Provider catalog fetch currently supports custom OpenAI-compatible providers only");
    }
    if (!provider.baseUrl) {
      throw new Error(`providers.${providerId}.baseUrl is required`);
    }
    const apiKeyEnv = "apiKeyEnv" in provider ? provider.apiKeyEnv : undefined;
    const apiKey = provider.apiKey || (apiKeyEnv ? process.env[apiKeyEnv] : undefined);
    if (!apiKey) {
      throw new Error(apiKeyEnv ? `${apiKeyEnv} is not set` : "Provider API key is not configured");
    }
    const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}/models`;
    const response = await fetch(endpoint, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Provider /models request failed: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json() as {
      data?: Array<{ id?: unknown; name?: unknown }>;
      models?: Array<{ id?: unknown; name?: unknown }>;
    };
    const rawModels = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    return rawModels
      .map((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        const name = typeof model.name === "string" ? model.name : id;
        return id ? { id, displayName: name || id } : undefined;
      })
      .filter((model): model is ProviderCatalogModelSummary => Boolean(model))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async #selectedModelFromMeta(meta: CreateSessionMeta | SessionMeta, project: HostProject): Promise<SelectedModelSummary | undefined> {
    const config = await this.#configForProject(project.projectId);
    if (!config) {
      return "selectedModel" in meta ? meta.selectedModel : undefined;
    }
    const persistedSelection = "selectedModel" in meta ? meta.selectedModel : undefined;
    const requestedSelection = "modelSelection" in meta ? meta.modelSelection : undefined;
    const selection = resolveModelSelection(
      config,
      persistedSelection
        ? { modelId: persistedSelection.modelId, role: persistedSelection.role }
        : requestedSelection,
    );
    const model = resolvePiAiModel(selection.config);
    return {
      modelId: selection.modelId,
      role: selection.role,
      providerId: selection.providerId,
      provider: model.provider,
      id: model.id,
      displayName: selection.displayName,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      supportsImageInput: model.input.includes("image"),
    };
  }

  async #configForProject(projectId?: ProjectId): Promise<ScorelConfig | undefined> {
    if (this.#loadConfig) {
      if (!projectId) {
        return this.#modelProfile;
      }
      const project = await this.#registry.require(projectId);
      return this.#loadConfig({ project });
    }
    return this.#modelProfile;
  }

  async #configProfileForProject(projectId?: ProjectId): Promise<ScorelConfigProfile | ScorelConfig | undefined> {
    if (this.#loadConfigProfile) {
      if (!projectId) {
        return this.#modelProfile;
      }
      const project = await this.#registry.require(projectId);
      return this.#loadConfigProfile({ project });
    }
    if (this.#loadConfig) {
      if (!projectId) {
        return this.#modelProfile;
      }
      const project = await this.#registry.require(projectId);
      try {
        return await loadScorelConfigProfile({ cwd: project.workDir });
      } catch (cause) {
        if (!isMissingConfigError(cause)) {
          throw cause;
        }
      }
    }
    return this.#modelProfile;
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
      throw new Error("ScorelHost is not started");
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

  async #appendHostDiagnostic(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    const line = formatDiagnosticLine({ ts: this.#now(), level: "info", event, ...fields });
    await mkdir(this.#sessionsDir, { recursive: true });
    await appendFile(join(this.#sessionsDir, "host.log"), `${line}\n`, "utf8");
  }

  async #resolveProject(sessionId: SessionId, projectId: ProjectId): Promise<HostProject> {
    const project = await this.#registry.require(projectId);
    await this.#appendDiagnostic(sessionId, "project_resolved", {
      projectId: project.projectId,
      workDir: project.workDir,
    });
    return project;
  }
}

const isMissingConfigError = (cause: unknown): boolean =>
  cause instanceof Error && cause.message.startsWith("Scorel config not found:");

export const createEmbeddedTransport = (host: ScorelHost): DaemonTransport => {
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
      const result = host.connect(connection, params.sessionId);
      connection.emit({
        type: "connected",
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
      });
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
      };
    },
    send(message) {
      return host.handleMessage(connection, message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      host.disconnect(connection);
      handlers.clear();
    },
  };
};

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

const wireErrorCode = (cause: unknown): "project_not_found" | "project_has_sessions" | "filesystem_error" | "conflict" | "internal_error" => {
  if (!(cause instanceof ProjectRegistryError)) {
    return "internal_error";
  }
  return cause.code;
};

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

const normalizeContent = (content: string | ScorelMessage["content"]): ScorelMessage["content"] =>
  typeof content === "string" ? [{ type: "text", text: content }] : content;

const inputText = (message: ScorelMessage): string =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

const assistantText = (message: ScorelMessage): string =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

const sanitizeSessionTitle = (value: string): string => {
  const title = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!?。！？]+$/g, "")
    .trim();
  if (!title) {
    return "";
  }
  return title.slice(0, 80);
};

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
