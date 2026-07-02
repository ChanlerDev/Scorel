import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";

import { listDirectories as browseDirectories } from "./projects/directories.js";
import { ProjectRegistry, ProjectRegistryError } from "./projects/registry.js";
import { listSessionSummaries } from "./projects/sessions.js";

import {
  ScorelRuntime,
  buildContext,
  buildInstructionSnapshot,
  buildObservationAsset,
  buildMemoryContext,
  corePackageName,
  createAppendDailyTool,
  createCodingTools,
  createSendChannelMessageTool,
  createSkillTool,
  createSnipTool,
  createSystemReminderBlock,
  diffSkillIndex,
  createPiAiProvider,
  createSession,
  hasSkillIndexDelta,
  listAvailableModels,
  listProviderConnections,
  listProviderModels,
  loadScorelConfig,
  loadScorelConfigProfile,
  loadExtensionManifest,
  loadSession,
  renderMemoryConfig,
  renderObservabilityConfig,
  renderRuntimeConfig,
  renderExtensionConfig,
  renderMemoryHarness,
  renderSkillDelta,
  renderSkillListing,
  renderSystemPrompt,
  renderModelProfileConfig,
  readMemoryDreamState,
  readSessionMemory,
  resolveModelSelection,
  resolvePiAiModel,
  scanSkillIndex,
  sessionArtifactsDirPath,
  sessionLogFilePath,
  snipUserMessageAlias,
  scorelSessionsDir,
  scorelMemoryPaths,
  syncObservationAssetTargets,
  writeMemoryDreamState,
  writeSessionMemory,
  type ExtensionManifest,
  type BackgroundBashCompletion,
  type BackgroundBashDeliveryHooks,
  type ScorelConfig,
  type ScorelConfigProfile,
  type JsonlSession,
  type RawRuntimeEvent,
} from "@scorel/core";
import {
  asClientId,
  asDeviceId,
  asEventId,
  asRequestId,
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
  type InstructionSnapshot,
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
  type ChannelContext,
  type MemoryStatus,
  type ModelSelectionInput,
  type ExtensionSettings,
  type MemorySettings,
  type ObservabilitySettings,
  type RuntimeSettings,
} from "@scorel/protocol";

export const daemonPackageName = "@scorel/daemon" as const;
export const daemonCoreDependency = corePackageName;
export const daemonProtocolDependency = protocolPackageName;
export const daemonProtocolVersion = protocolVersion;
const SESSION_MEMORY_COMPACT_WAIT_MS = 5_000;
const AUTO_COMPACT_RETAINED_EVENTS = 8;
const execFileAsync = promisify(execFile);
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
  launchIntent: "attached" | "user_started";
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
    launchIntent: options.launchIntent,
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
      !(raw.stoppedAt === null || typeof raw.stoppedAt === "number") ||
      !(raw.launchIntent === "attached" || raw.launchIntent === "user_started")
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
      launchIntent: raw.launchIntent,
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
  sessionsDir?: string;
  sessionId?: SessionId;
  modelSelection?: { modelId?: string; role?: "primary" | "standard" | "auxiliary" };
  includeTools?: boolean;
  rtkExecutable?: string;
  backgroundBash?: BackgroundBashDeliveryHooks;
};

export type ScorelHostOptions = {
  sessionsDir: string;
  projectsPath: string;
  deviceId: DeviceId;
  deviceDisplayName?: string;
  scorelHomeDir?: string;
  builtinExtensionsDir?: string;
  modelProfile?: ScorelConfig;
  loadConfig?: (options: { project: HostProject }) => Promise<ScorelConfig>;
  loadConfigProfile?: (options: { project: HostProject }) => Promise<ScorelConfigProfile | ScorelConfig>;
  createRuntime: (options: {
    sessionId: SessionId;
    project: HostProject;
    selectedModel?: SelectedModelSummary;
    purpose: "chat" | "title" | "memory";
    backgroundBash?: BackgroundBashDeliveryHooks;
  }) => Promise<ScorelRuntime>;
  memoryHomeDir?: string;
  onSessionListChanged?: (change: { projectId: ProjectId; sessionId: SessionId }) => void;
  onLastClientDisconnect?: () => void;
  now?: () => number;
  createId?: () => string;
};

export type ImIncomingMessage = {
  externalConversationId: string;
  text: string;
  conversationType?: string;
  senderDisplayName?: string;
  mentionedBot?: boolean;
  target?: ImTarget;
  data?: Record<string, unknown>;
};

export type ImTarget = {
  externalConversationId: string;
  data?: Record<string, unknown>;
};

export type ImOutgoingMessage = {
  text?: string;
  attachments?: Array<{
    type: "image" | "file";
    path?: string;
    url?: string;
    mimeType?: string;
    caption?: string;
  }>;
};

export type ImAdapterContext = {
  onMessage(message: ImIncomingMessage): Promise<void>;
  logger: {
    info(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };
};

export type ImAdapter = {
  start(ctx: ImAdapterContext): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: ImTarget, message: ImOutgoingMessage): Promise<void>;
  setTyping?(target: ImTarget, typing: boolean): Promise<void>;
  getOutbox?(): ImOutgoingMessage[];
};

export const createRealRuntime = async (options: RuntimeFactoryOptions): Promise<ScorelRuntime> => {
  const selection = resolveModelSelection(options.config, options.modelSelection);
  const model = resolvePiAiModel(selection.config);
  const rtkExecutable = options.rtkExecutable ?? (options.config.runtime.tokenSavingRtk ? (await detectRtk()).executable : undefined);
  const runtime = new ScorelRuntime({
    provider: createPiAiProvider({
      model,
      apiKey: selection.config.apiKey,
    }),
  });
  if (options.includeTools !== false) {
    for (const tool of createCodingTools({
      cwd: options.cwd,
      contextWindow: model.contextWindow,
      ...(options.sessionsDir && options.sessionId
        ? { toolResultArtifacts: { dir: sessionArtifactsDirPath(options.sessionsDir, options.sessionId) } }
        : {}),
      tokenSaving: {
        rtk: {
          enabled: options.config.runtime.tokenSavingRtk,
          executable: rtkExecutable,
        },
      },
      backgroundBash: options.backgroundBash,
    })) {
      runtime.registerTool(tool);
    }
  }
  return runtime;
};

type SessionLane = {
  session: JsonlSession;
  project: HostProject;
  runtime: ScorelRuntime;
  selectedModel?: SelectedModelSummary;
  queue: Promise<unknown>;
  appendQueue: Promise<void>;
  followUpWaiters: Map<string, { connection: Connection; request: ClientRequest<"send_message"> }>;
  channelContext?: RuntimeChannelContext;
  snipClientId?: ClientId;
};

type RuntimeChannelContext = ChannelContext & {
  extensionId: string;
  target: ImTarget;
};

type LoadedImExtension = {
  manifest: ExtensionManifest;
  adapter: ImAdapter;
  skillRoots: string[];
};

type ImSessionBinding = {
  extensionId: string;
  externalConversationId: string;
  projectId: ProjectId;
  sessionId: SessionId;
  createdAt: number;
  updatedAt: number;
};

type MemoryDreamSchedule = {
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  sessionId: SessionId;
  clientId: ClientId;
  lastActivityAt: number;
};

type AfterUserMessageHook = (input: {
  lane: SessionLane;
  clientId: ClientId;
  userEvent: Extract<PersistentEvent, { type: "user_message" }>;
}) => Promise<void>;

type PersistentEventInput =
  | Omit<Extract<PersistentEvent, { type: "user_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "assistant_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "tool_result" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "session_title_updated" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "instruction_snapshot" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "harness_item" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "compact" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "context_control" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "queue_update" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "skill_index_snapshot" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "skill_index_delta" }>, "seq">;

type TransientEventInput =
  | Omit<Extract<TransientEvent, { type: "turn_start" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "turn_end" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "message_start" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "text_delta" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "thinking_delta" }>, "seq">
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
  readonly #scorelHomeDir: string;
  readonly #userHomeDir: string;
  readonly #builtinExtensionsDir: string;
  readonly #modelProfile: ScorelConfig | undefined;
  readonly #loadConfig: ((options: { project: HostProject }) => Promise<ScorelConfig>) | undefined;
  readonly #loadConfigProfile: ((options: { project: HostProject }) => Promise<ScorelConfigProfile | ScorelConfig>) | undefined;
  readonly #createRuntime: ScorelHostOptions["createRuntime"];
  readonly #memoryHomeDir: string | undefined;
  readonly #onSessionListChanged: ((change: { projectId: ProjectId; sessionId: SessionId }) => void) | undefined;
  readonly #onLastClientDisconnect: (() => void) | undefined;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #sessions = new Map<SessionId, SessionLane>();
  readonly #connections = new Set<Connection>();
  readonly #events = new Map<SessionId, ScorelEvent[]>();
  readonly #seqs = new Map<SessionId, number>();
  readonly #memoryDreams = new Map<ProjectId, MemoryDreamSchedule>();
  readonly #sessionMemoryUpdates = new Map<SessionId, Promise<void>>();
  readonly #imExtensions = new Map<string, LoadedImExtension>();
  readonly #imBindings = new Map<string, ImSessionBinding>();
  readonly #registry: ProjectRegistry;
  #runtimeStatsQueue: Promise<void> = Promise.resolve();
  #hadClientConnection = false;
  #lastActiveWorkAt: number;
  #started = false;

  constructor(options: ScorelHostOptions) {
    this.#sessionsDir = options.sessionsDir;
    this.#deviceId = options.deviceId;
    this.#deviceDisplayName = options.deviceDisplayName;
    this.#scorelHomeDir = resolve(options.scorelHomeDir ?? dirname(options.projectsPath));
    this.#userHomeDir = dirname(this.#scorelHomeDir);
    this.#builtinExtensionsDir = resolve(options.builtinExtensionsDir ?? defaultBuiltinExtensionsDir());
    this.#modelProfile = options.modelProfile;
    this.#loadConfig = options.loadConfig;
    this.#loadConfigProfile = options.loadConfigProfile;
    this.#createRuntime = options.createRuntime;
    this.#memoryHomeDir = options.memoryHomeDir;
    this.#onSessionListChanged = options.onSessionListChanged;
    this.#onLastClientDisconnect = options.onLastClientDisconnect;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#lastActiveWorkAt = this.#now();
    this.#registry = new ProjectRegistry({
      sessionsDir: this.#sessionsDir,
      projectsPath: options.projectsPath,
      createId: this.#createId,
      now: this.#now,
    });
  }

  async start(): Promise<void> {
    this.#started = true;
    await mkdir(this.#scorelHomeDir, { recursive: true });
    await this.#loadImBindings();
    await this.#startEnabledImExtensions();
  }

  async shutdown(): Promise<void> {
    for (const schedule of this.#memoryDreams.values()) {
      if (schedule.timer) {
        clearTimeout(schedule.timer);
      }
    }
    this.#memoryDreams.clear();
    await this.#stopImExtensions();
    this.#connections.clear();
    this.#hadClientConnection = false;
    this.#started = false;
  }

  async refreshImExtensions(): Promise<void> {
    this.#assertStarted();
    await this.#stopImExtensions();
    await this.#startEnabledImExtensions();
  }

  connect(connection: Connection, sessionId?: SessionId): ConnectResult {
    this.#assertStarted();
    this.#hadClientConnection = true;
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
    if (this.#started && this.#hadClientConnection && this.#connections.size === 0) {
      this.#onLastClientDisconnect?.();
    }
  }

  releaseSessionEventBuffer(sessionId: SessionId): void {
    this.#events.delete(sessionId);
  }

  activityStatus(): { activeWork: boolean; lastActiveWorkAt: number } {
    const activeWork = this.#hasActiveWork();
    if (activeWork) {
      this.#lastActiveWorkAt = this.#now();
    }
    return { activeWork, lastActiveWorkAt: this.#lastActiveWorkAt };
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

  async receiveImMessage(extensionId: string, message: ImIncomingMessage): Promise<SessionId> {
    this.#assertStarted();
    const extension = this.#imExtensions.get(extensionId);
    if (!extension) {
      throw new Error(`IM extension is not enabled: ${extensionId}`);
    }
    return this.#handleImMessage(extension, message);
  }

  loopbackOutbox(extensionId = "loopback"): ImOutgoingMessage[] {
    return this.#imExtensions.get(extensionId)?.adapter.getOutbox?.() ?? [];
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
      case "remove_model_provider": {
        this.#respond(connection, message, await this.#handleRemoveModelProvider(message));
        break;
      }
      case "fetch_provider_models": {
        this.#respond(connection, message, { models: await this.#fetchProviderModels(message.projectId, message.providerId) });
        break;
      }
      case "get_memory_settings": {
        this.#respond(connection, message, { memory: await this.#memorySettings(message.projectId) });
        break;
      }
      case "get_memory_status": {
        this.#respond(connection, message, { status: await this.#memoryStatusForProject(message.projectId) });
        break;
      }
      case "upsert_memory_settings": {
        this.#respond(connection, message, { memory: await this.#handleUpsertMemorySettings(message) });
        break;
      }
      case "get_runtime_settings": {
        this.#respond(connection, message, { runtime: await this.#runtimeSettings(message.projectId) });
        break;
      }
      case "upsert_runtime_settings": {
        this.#respond(connection, message, { runtime: await this.#handleUpsertRuntimeSettings(message) });
        break;
      }
      case "get_observability_settings": {
        this.#respond(connection, message, { observability: await this.#observabilitySettings(message.projectId) });
        break;
      }
      case "upsert_observability_settings": {
        this.#respond(connection, message, { observability: await this.#handleUpsertObservabilitySettings(message) });
        break;
      }
      case "get_extension_settings": {
        this.#respond(connection, message, { extension: await this.#extensionSettings(message.extensionId) });
        break;
      }
      case "upsert_extension_settings": {
        this.#respond(connection, message, { extension: await this.#handleUpsertExtensionSettings(message) });
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

  #hasActiveWork(): boolean {
    for (const lane of this.#sessions.values()) {
      if (lane.runtime.running) {
        return true;
      }
      if (lane.runtime.hasActiveToolWork()) {
        return true;
      }
      if (
        lane.session.tree.controlState.queues.follow_up.length > 0 ||
        lane.session.tree.controlState.queues.steer.length > 0
      ) {
        return true;
      }
    }
    return false;
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
    if (created) {
      this.#onSessionListChanged?.({ projectId: lane.project.projectId, sessionId });
    }
    this.#respond(connection, request, { sessionId });
  }

  async #handleLoadSession(connection: Connection, request: ClientRequest<"load_session">): Promise<void> {
    try {
      const lane = this.#sessions.get(request.sessionId);
      const session = lane?.session ?? await loadSession({ sessionsDir: this.#sessionsDir, sessionId: request.sessionId });
      await this.#appendDiagnostic(request.sessionId, "session_loaded", { clientId: connection.clientId });
      connection.sessionId = request.sessionId;
      const persistentEvents = [...session.tree];
      const sessionEvents = this.#events.get(request.sessionId) ?? [];
      if (sessionEvents.length === 0 && persistentEvents.length > 0) {
        this.#events.set(request.sessionId, persistentEvents);
      }
      this.#seqs.set(request.sessionId, Number(session.currentSeq));
      this.#respond(connection, request, {
        sessionId: request.sessionId,
        activeLeafId: session.activeLeafId,
        currentSeq: session.currentSeq,
        events: persistentEvents,
        meta: session.header.meta,
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
        modelSelection: request.options?.modelSelection,
        channelContext: request.options?.channelContext ? runtimeChannelContextFromWire(request.options.channelContext) : undefined,
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
      modelSelection?: ModelSelectionInput;
      channelContext?: RuntimeChannelContext;
      onComplete?: (result: Required<Pick<ClientRequestMap["send_message"]["response"], "userEventId" | "assistantEventId">>) => void;
    },
  ): Promise<ClientRequestMap["send_message"]["response"]> {
    this.#lastActiveWorkAt = this.#now();
    const sessionId = lane.session.header.sessionId;
    await this.#selectChatRuntime(lane, input.modelSelection);
    await this.#appendDiagnostic(sessionId, "send_message_started", {
      clientId,
      activeLeafId: lane.session.activeLeafId,
      source: input.source,
      selectedModelId: lane.selectedModel?.modelId,
    });
    const instructionSnapshot = await this.#ensureInstructionSnapshot(lane, clientId);
    await this.#syncSkillIndex(lane, clientId);
    await this.#ensureMemoryHarness(lane, clientId);
    await this.#syncMemoryTools(lane, clientId);
    await this.#autoCompactIfNeeded(lane, clientId);
    this.#syncChannelTool(lane, input.channelContext);
    let parentId = input.parentId === undefined ? lane.session.activeLeafId : input.parentId;
    if (input.channelContext) {
      const channelHarness = await this.#appendChannelHarness(lane, clientId, input.channelContext, parentId);
      parentId = channelHarness.id;
    }
    const userEventId = asEventId(this.#createId());
    const userEvent = await this.#appendPersistent(lane, {
      type: "user_message",
      id: userEventId,
      parentId,
      sessionId,
      clientId,
      ts: this.#now(),
      message: {
        role: "user",
        content: [...input.content, snipUserMessageIdBlock(userEventId)],
        ...(input.source === "follow_up"
          ? { meta: { source: "follow_up", queueItemId: input.queueItemId } }
          : {}),
      },
    }) as Extract<PersistentEvent, { type: "user_message" }>;
    const runAfterUserMessageHooks = this.#scheduleAfterUserMessageHooks(lane, clientId, userEvent);
    void runAfterUserMessageHooks().catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      void this.#appendDiagnostic(sessionId, "after_user_message_hook_failed", {
        clientId,
        message: error.message,
        stack: shortStack(error),
      });
    });
    const firstAssistantEventId = asEventId(this.#createId());
    const state: RuntimeEventState = {
      parentId: userEvent.id,
      assistantEventId: firstAssistantEventId,
      finalAssistantEventId: firstAssistantEventId,
    };

    lane.channelContext = input.channelContext;
    lane.snipClientId = clientId;
    try {
      await this.#executeRuntimeLoop(lane, clientId, state, userEvent.id, instructionSnapshot);
    } finally {
      lane.channelContext = undefined;
      lane.snipClientId = undefined;
      lane.runtime.unregisterTool("SendChannelMessage");
    }

    const result = { userEventId, assistantEventId: state.finalAssistantEventId };
    await this.#appendDiagnostic(sessionId, "send_message_finished", {
      clientId,
      userEventId,
      assistantEventId: state.finalAssistantEventId,
      source: input.source,
    });
    this.#scheduleSessionMemoryUpdate(lane, clientId);
    void this.#syncObservabilityAfterTurn(lane).catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      void this.#appendDiagnostic(sessionId, "observability_sync_failed", {
        message: error.message,
        stack: shortStack(error),
      });
    });
    input.onComplete?.(result);
    return { ...result, status: "completed" };
  }

  async #executeRuntimeLoop(
    lane: SessionLane,
    clientId: ClientId,
    state: RuntimeEventState,
    contextLeafId: EventId,
    instructionSnapshot: InstructionSnapshot,
  ): Promise<void> {
    for await (const rawEvent of lane.runtime.executeTurn(
      buildContext(lane.session.tree, contextLeafId),
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
  }

  async #runSystemReminderTurn(lane: SessionLane, clientId: ClientId, reminderEventId: EventId): Promise<void> {
    this.#lastActiveWorkAt = this.#now();
    const sessionId = lane.session.header.sessionId;
    await this.#selectChatRuntime(lane, undefined);
    await this.#appendDiagnostic(sessionId, "system_reminder_turn_started", {
      clientId,
      reminderEventId,
      selectedModelId: lane.selectedModel?.modelId,
    });
    const instructionSnapshot = await this.#ensureInstructionSnapshot(lane, clientId);
    await this.#syncSkillIndex(lane, clientId);
    await this.#ensureMemoryHarness(lane, clientId);
    await this.#syncMemoryTools(lane, clientId);
    await this.#autoCompactIfNeeded(lane, clientId);
    this.#syncChannelTool(lane, undefined);
    const firstAssistantEventId = asEventId(this.#createId());
    const state: RuntimeEventState = {
      parentId: reminderEventId,
      assistantEventId: firstAssistantEventId,
      finalAssistantEventId: firstAssistantEventId,
    };
    try {
      await this.#executeRuntimeLoop(lane, clientId, state, reminderEventId, instructionSnapshot);
    } finally {
      lane.runtime.unregisterTool("SendChannelMessage");
    }
    await this.#appendDiagnostic(sessionId, "system_reminder_turn_finished", {
      clientId,
      reminderEventId,
      assistantEventId: state.finalAssistantEventId,
    });
    this.#scheduleSessionMemoryUpdate(lane, clientId);
    void this.#syncObservabilityAfterTurn(lane).catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      void this.#appendDiagnostic(sessionId, "observability_sync_failed", {
        message: error.message,
        stack: shortStack(error),
      });
    });
  }

  async #syncObservabilityAfterTurn(lane: SessionLane): Promise<void> {
    const config = await this.#configForProject(lane.project.projectId);
    const results = await syncObservationAssetTargets({
      asset: buildObservationAsset(lane.session),
      config,
      stateDir: this.#scorelHomeDir,
    });
    for (const result of results) {
      await this.#appendDiagnostic(lane.session.header.sessionId, "observability_sync_completed", {
        target: result.target,
        status: result.status,
        events: result.events,
        reason: result.reason,
      });
    }
  }

  #backgroundBashForSession(sessionId: SessionId): BackgroundBashDeliveryHooks {
    return {
      onComplete: async (completion) => this.#handleBackgroundBashCompleted(sessionId, completion),
      isDeliveryVisible: ({ task_id }) => this.#backgroundBashDeliveryVisible(sessionId, task_id),
    };
  }

  async #handleBackgroundBashCompleted(
    sessionId: SessionId,
    completion: BackgroundBashCompletion,
  ): Promise<{ eventId?: string } | void> {
    const lane = this.#sessions.get(sessionId);
    if (!lane) {
      return undefined;
    }
    const clientId = asClientId("client_system");
    const parentId = lane.session.activeLeafId;
    if (!parentId) {
      return undefined;
    }
    const resultText = toolResultText(completion.result);
    const event = await this.#appendPersistent(lane, {
      type: "harness_item",
      id: asEventId(this.#createId()),
      parentId,
      sessionId,
      clientId,
      ts: this.#now(),
      item: {
        kind: "runtime_notice",
        origin: "system",
        visibility: "hidden",
        content: [
          `Background Bash task completed: ${completion.task_id}`,
          `pid: ${completion.pid}`,
          `cwd: ${completion.cwd}`,
          "",
          resultText,
          "",
          "This Bash result has already been injected through a system reminder.",
          "Do not call Bash with this task_id again unless the user explicitly asks for the raw result.",
        ].join("\n"),
        data: {
          type: "background_bash_completed",
          task_id: completion.task_id,
          pid: completion.pid,
          cwd: completion.cwd,
        },
      },
    });
    await this.#appendDiagnostic(sessionId, "background_bash_completed", {
      clientId,
      taskId: completion.task_id,
      pid: completion.pid,
      harnessEventId: event.id,
      runtimeRunning: lane.runtime.running,
    });
    if (!lane.runtime.running) {
      lane.queue = lane.queue.then(() => this.#runSystemReminderTurn(lane, clientId, event.id));
      void lane.queue.catch((cause) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        void this.#appendDiagnostic(sessionId, "system_reminder_turn_failed", {
          clientId,
          reminderEventId: event.id,
          message: error.message,
          stack: shortStack(error),
        });
      });
    }
    return { eventId: event.id };
  }

  #backgroundBashDeliveryVisible(sessionId: SessionId, taskId: string): boolean {
    const lane = this.#sessions.get(sessionId);
    const leafId = lane?.session.activeLeafId;
    if (!lane || !leafId) {
      return false;
    }
    return buildContext(lane.session.tree, leafId).some((message) => messageHasBackgroundBashReminder(message, taskId));
  }

  #scheduleAfterUserMessageHooks(
    lane: SessionLane,
    clientId: ClientId,
    userEvent: Extract<PersistentEvent, { type: "user_message" }>,
  ): () => Promise<void> {
    const hooks: AfterUserMessageHook[] = [
      ({ lane: hookLane, clientId: hookClientId, userEvent: hookUserEvent }) =>
        this.#runSessionTitleHook(hookLane, hookClientId, hookUserEvent),
    ];
    return async () => {
      for (const hook of hooks) {
        await hook({ lane, clientId, userEvent });
      }
    };
  }

  async #runSessionTitleHook(
    lane: SessionLane,
    clientId: ClientId,
    userEvent: Extract<PersistentEvent, { type: "user_message" }>,
  ): Promise<void> {
    const sessionId = lane.session.header.sessionId;
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
          content: [{
            type: "text",
            text: [
              "Write a session title for the following first user request.",
              "",
              "Rules:",
              "- Return only the title text.",
              "- Do not answer the request.",
              "- Do not mention yourself.",
              "- Use the same language as the request when obvious.",
              "- Prefer a short noun phrase or task label, 4 to 12 Chinese characters or 4 to 8 English words.",
              "- No quotes, punctuation, or trailing period.",
              "",
              "<user_request>",
              text.slice(0, 4_000),
              "</user_request>",
            ].join("\n"),
          }],
        },
      ],
      [
        "You generate concise chat session titles.",
        "You are not answering the user request.",
        "You only summarize the user's intent as a short title.",
        "If the request is in Chinese, output Chinese.",
        "Output plain text only.",
      ].join("\n"),
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
      ...(request.options?.channelContext || request.options?.modelSelection
        ? { data: { channelContext: request.options.channelContext, modelSelection: request.options.modelSelection } }
        : {}),
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
      ...(request.options?.channelContext ? { data: { channelContext: request.options.channelContext } } : {}),
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
        modelSelection: parseQueuedModelSelection(item.data?.modelSelection),
        channelContext: parseQueuedChannelContext(item.data?.channelContext),
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
      case "thinking_delta":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "thinking_delta",
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
          thinkingBlocks: countContentBlocks(rawEvent.message, "thinking"),
          textBlocks: countContentBlocks(rawEvent.message, "text"),
          toolCalls: countContentBlocks(rawEvent.message, "tool_call"),
          ...(typeof rawEvent.message.meta?.errorMessage === "string" ? { errorMessage: rawEvent.message.meta.errorMessage } : {}),
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
        const rtkSavings = rtkSavingsFromToolResult(rawEvent.result);
        if (rtkSavings) {
          await this.#recordRtkSavings({
            projectId: lane.project.projectId,
            sessionId: lane.session.header.sessionId,
            savings: rtkSavings,
          }).catch((cause) =>
            this.#appendDiagnostic(lane.session.header.sessionId, "runtime_stats_update_failed", {
              message: cause instanceof Error ? cause.message : String(cause),
            }),
          );
        }
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
    let appended: PersistentEvent | undefined;
    const appendTask = lane.appendQueue.then(async () => {
      const withSeq = { ...event, seq: this.#nextSeq(lane.session.header.sessionId) } as PersistentEvent;
      await lane.session.append(withSeq);
      this.#recordAndBroadcast(lane.session.header.sessionId, withSeq);
      appended = withSeq;
    });
    lane.appendQueue = appendTask.catch(() => {});
    await appendTask;
    return appended!;
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
    const entries = await scanSkillIndex({ cwd: lane.project.workDir, extensionSkillRoots: this.#extensionSkillRoots() });
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

  async #ensureMemoryHarness(lane: SessionLane, clientId: ClientId): Promise<void> {
    const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
    if (!memory.enabled) {
      return;
    }
    for (const event of lane.session.tree) {
      if (
        event.type === "harness_item" &&
        event.item.kind === "memory"
      ) {
        return;
      }
    }
    const context = await buildMemoryContext({
      projectId: lane.project.projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    await this.#appendPersistent(lane, {
      type: "harness_item",
      id: asEventId(this.#createId()),
      parentId: lane.session.activeLeafId,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      item: {
        kind: "memory",
        origin: "system",
        content: renderMemoryHarness(context),
        visibility: "hidden",
        data: {
          date: context.paths.today,
          projectId: lane.project.projectId,
        },
      },
    });
  }

  async #syncMemoryTools(lane: SessionLane, clientId: ClientId): Promise<void> {
    const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
    if (!memory.enabled || !memory.daily) {
      lane.runtime.unregisterTool("AppendDaily");
      return;
    }
    lane.runtime.registerTool(
      createAppendDailyTool({
        projectId: lane.project.projectId,
        homeDir: this.#memoryHomeDir,
        now: this.#now,
        onAppend: async (result) => {
          if (result.entry) {
            await this.#markMemoryDreamDirty(lane, clientId, result.path);
          }
          try {
            await this.#appendDiagnostic(lane.session.header.sessionId, "memory_daily_appended", {
              clientId,
              path: result.path,
              date: result.date,
              skippedReason: result.skippedReason,
            });
          } catch {
            // Diagnostics are observability only; daily append and dream scheduling must survive log failures.
          }
          if (result.entry) {
            await this.#scheduleMemoryDream(lane, clientId);
          }
        },
      }),
    );
  }

  async #autoCompactIfNeeded(lane: SessionLane, clientId: ClientId): Promise<void> {
    const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
    if (memory.autoCompactThreshold <= 0) {
      return;
    }
    const leafId = lane.session.activeLeafId;
    if (!leafId) {
      return;
    }
    const leaf = lane.session.tree.get(leafId)?.event;
    if (leaf?.type === "compact") {
      return;
    }
    const context = buildContext(lane.session.tree, leafId);
    const tokensBefore = estimateScorelMessagesTokens(context);
    const contextWindow = lane.session.header.meta.selectedModel?.contextWindow ?? 200_000;
    const threshold = Math.floor(contextWindow * memory.autoCompactThreshold);
    if (tokensBefore < threshold) {
      return;
    }
    await this.#waitForSessionMemoryUpdate(lane.session.header.sessionId, SESSION_MEMORY_COMPACT_WAIT_MS);
    const sessionMemory = memory.sessionMemory ? await this.#readSessionMemory(lane) : "";
    const compactSource = sessionMemory ? "session_memory" : "foreground_compact";
    const compactSummary = sessionMemory || await this.#generateForegroundCompactSummary(lane).catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      void this.#appendDiagnostic(lane.session.header.sessionId, "foreground_compact_failed", {
        clientId,
        message: error.message,
        stack: shortStack(error),
      });
      return "";
    });
    const summary = [
      compactSummary || this.#fallbackSessionMemorySummary(lane).summary,
    ].join("\n").trim();
    const compacted = await this.#appendPersistent(lane, {
      type: "compact",
      id: asEventId(this.#createId()),
      parentId: leafId,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      summary,
      compactedThrough: leafId,
      tokensBefore,
      tokensAfter: estimateTextTokens(summary),
      retainedEventCount: AUTO_COMPACT_RETAINED_EVENTS,
    });
    await this.#appendDiagnostic(lane.session.header.sessionId, "auto_compacted", {
      clientId,
      compactEventId: compacted.id,
      source: compactSource,
      tokensBefore,
      tokensAfter: "tokensAfter" in compacted ? compacted.tokensAfter : undefined,
      threshold,
    });
  }

  #scheduleSessionMemoryUpdate(lane: SessionLane, clientId: ClientId): void {
    const sessionId = lane.session.header.sessionId;
    const previous = this.#sessionMemoryUpdates.get(sessionId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => this.#maintainSessionMemory(lane, clientId));
    this.#sessionMemoryUpdates.set(sessionId, task);
    void task.catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      void this.#appendDiagnostic(sessionId, "session_memory_update_failed", {
        clientId,
        message: error.message,
        stack: shortStack(error),
      });
    }).finally(() => {
      if (this.#sessionMemoryUpdates.get(sessionId) === task) {
        this.#sessionMemoryUpdates.delete(sessionId);
      }
    });
  }

  async #waitForSessionMemoryUpdate(sessionId: SessionId, timeoutMs: number): Promise<void> {
    const update = this.#sessionMemoryUpdates.get(sessionId);
    if (!update) {
      return;
    }
    await Promise.race([
      update.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async #readSessionMemory(lane: SessionLane): Promise<string> {
    return (await readSessionMemory({
      projectId: lane.project.projectId,
      sessionId: lane.session.header.sessionId,
      homeDir: this.#memoryHomeDir,
    })).trim();
  }

  async #maintainSessionMemory(lane: SessionLane, clientId: ClientId): Promise<void> {
    const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
    if (!memory.sessionMemory) {
      return;
    }
    const current = await this.#readSessionMemory(lane);
    const generated = await this.#generateSessionMemory(lane, current).catch(() => undefined);
    const fallback = this.#fallbackSessionMemorySummary(lane);
    const result = await writeSessionMemory({
      projectId: lane.project.projectId,
      sessionId: lane.session.header.sessionId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
      summary: generated?.summary ?? fallback.summary,
      recentMessages: generated?.recentMessages ?? fallback.recentMessages,
      decisions: generated?.decisions ?? fallback.decisions,
      followUps: generated?.followUps ?? fallback.followUps,
    });
    await this.#appendDiagnostic(lane.session.header.sessionId, "session_memory_updated", {
      clientId,
      path: result.path,
      bytes: result.content.length,
    });
  }

  async #generateForegroundCompactSummary(lane: SessionLane): Promise<string> {
    const selectedModel = await this.#selectedModelFromMeta(
      { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
      lane.project,
    );
    if (!selectedModel) {
      return "";
    }
    const runtime = await this.#createRuntime({
      sessionId: lane.session.header.sessionId,
      project: lane.project,
      selectedModel,
      purpose: "memory",
    });
    const prompt = [
      "Compact the Scorel session context for continuation.",
      "Return a dense markdown summary only. Do not mention these instructions.",
      "Preserve current task, user requirements, decisions, important files/functions, errors, commands, and next steps.",
      "",
      "<recent_events>",
      this.#recentConversationLines(lane, 40).join("\n"),
      "</recent_events>",
    ].join("\n");
    let raw = "";
    for await (const rawEvent of runtime.executeTurn(
      [{ role: "user", content: [{ type: "text", text: prompt }] }],
      "You compact session context. Output markdown only.",
      {},
    )) {
      if (rawEvent.type === "text_delta") {
        raw += rawEvent.delta;
      } else if (rawEvent.type === "message_end") {
        raw = assistantText(rawEvent.message) || raw;
      } else if (rawEvent.type === "error") {
        throw rawEvent.error;
      }
    }
    return raw.trim();
  }

  async #generateSessionMemory(
    lane: SessionLane,
    current: string,
  ): Promise<{ summary?: string; recentMessages?: string[]; decisions?: string[]; followUps?: string[] } | undefined> {
    const selectedModel = await this.#selectedModelFromMeta(
      { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
      lane.project,
    );
    if (!selectedModel) {
      return undefined;
    }
    const runtime = await this.#createRuntime({
      sessionId: lane.session.header.sessionId,
      project: lane.project,
      selectedModel,
      purpose: "memory",
    });
    const prompt = [
      "Update Scorel session memory for context management. Return strict JSON only.",
      "This is not long-term memory. It is a compact current-session summary used by future auto compact.",
      "Keys: summary string, recentMessages string[], decisions string[], followUps string[].",
      "Keep it dense, current, and useful after old conversation history is replaced.",
      "",
      "<current_session_memory>",
      current.trim() || "(empty)",
      "</current_session_memory>",
      "",
      "<recent_events>",
      this.#recentConversationLines(lane, 24).join("\n"),
      "</recent_events>",
    ].join("\n");
    let raw = "";
    for await (const rawEvent of runtime.executeTurn(
      [{ role: "user", content: [{ type: "text", text: prompt }] }],
      "You maintain session memory for context compaction. Output strict JSON only.",
      {},
    )) {
      if (rawEvent.type === "text_delta") {
        raw += rawEvent.delta;
      } else if (rawEvent.type === "message_end") {
        raw = assistantText(rawEvent.message) || raw;
      } else if (rawEvent.type === "error") {
        throw rawEvent.error;
      }
    }
    return parseSessionMemoryJson(raw);
  }

  #fallbackSessionMemorySummary(lane: SessionLane): {
    summary: string;
    recentMessages: string[];
    decisions: string[];
    followUps: string[];
  } {
    const recentMessages = this.#recentConversationLines(lane, 12);
    return {
      summary: recentMessages.at(-1) ?? "Session is active. Continue from the latest visible user request.",
      recentMessages,
      decisions: [],
      followUps: [],
    };
  }

  #recentConversationLines(lane: SessionLane, limit: number): string[] {
    const events = [...lane.session.tree]
      .filter((event) => "message" in event || event.type === "compact")
      .slice(-limit);
    return events.map((event) => {
      if (event.type === "compact") {
        return `[compact] ${compactLine(event.summary, 500)}`;
      }
      return `[${event.message.role}] ${compactLine(messageText(event.message), 500)}`;
    });
  }

  async #appendChannelHarness(
    lane: SessionLane,
    clientId: ClientId,
    context: RuntimeChannelContext,
    parentId: EventId | null,
  ): Promise<Extract<PersistentEvent, { type: "harness_item" }>> {
    const lines = [
      "This message came from an IM channel.",
      "",
      `channel: ${context.channel}`,
      ...(context.conversationType ? [`conversation_type: ${context.conversationType}`] : []),
      ...(context.senderDisplayName ? [`sender_display_name: ${context.senderDisplayName}`] : []),
      ...(context.mentionedBot !== undefined ? [`mentioned_bot: ${context.mentionedBot}`] : []),
      "",
      "Use SendChannelMessage to reply to the current conversation when needed.",
      "In IM, send a short acknowledgement before long work so the user does not think the bot is stuck.",
      "For longer tasks, send concise progress updates instead of waiting until every tool call has finished.",
      "Keep replies conversational and avoid exposing internal tool names unless they help the user.",
    ];
    return this.#appendPersistent(lane, {
      type: "harness_item",
      id: asEventId(this.#createId()),
      parentId,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      item: {
        kind: "channel_context",
        origin: "system",
        content: lines.join("\n"),
        visibility: "hidden",
        data: {
          extensionId: context.extensionId,
          channel: context.channel,
          externalConversationId: context.externalConversationId,
          ...(context.conversationType ? { conversationType: context.conversationType } : {}),
          ...(context.mentionedBot !== undefined ? { mentionedBot: context.mentionedBot } : {}),
        },
      },
    }) as Promise<Extract<PersistentEvent, { type: "harness_item" }>>;
  }

  async #scheduleMemoryDream(lane: SessionLane, clientId: ClientId): Promise<void> {
    const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
    if (!memory.enabled || !memory.autoDream) {
      return;
    }
    const projectId = lane.project.projectId;
    const existing = this.#memoryDreams.get(projectId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const schedule: MemoryDreamSchedule = {
      running: existing?.running ?? false,
      sessionId: lane.session.header.sessionId,
      clientId,
      lastActivityAt: this.#now(),
    };
    const delayMs = Math.max(0, memory.dreamIdleMinutes) * 60 * 1000;
    const scheduledFor = this.#now() + delayMs;
    const currentState = await readMemoryDreamState({
      projectId: lane.project.projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    await this.#writeMemoryDreamState(lane.project.projectId, {
      ...(currentState ?? {}),
      projectId: String(lane.project.projectId),
      dirty: true,
      running: schedule.running,
      sessionId: String(lane.session.header.sessionId),
      clientId: String(clientId),
      lastDailyAppendAt: currentState?.lastDailyAppendAt ?? schedule.lastActivityAt,
      scheduledFor,
    });
    schedule.timer = setTimeout(() => {
      void this.#runIdleMemoryDream(projectId).catch((cause) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        void this.#appendDiagnostic(schedule.sessionId, "idle_memory_dream_failed", {
          clientId: schedule.clientId,
          message: error.message,
          stack: shortStack(error),
        });
      });
    }, delayMs);
    schedule.timer.unref?.();
    this.#memoryDreams.set(projectId, schedule);
    await this.#appendDiagnostic(lane.session.header.sessionId, "idle_memory_dream_scheduled", {
      clientId,
      projectId,
      idleMinutes: memory.dreamIdleMinutes,
    });
  }

  async #markMemoryDreamDirty(lane: SessionLane, clientId: ClientId, dailyPath: string): Promise<void> {
    const current = await readMemoryDreamState({
      projectId: lane.project.projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    await this.#writeMemoryDreamState(lane.project.projectId, {
      projectId: String(lane.project.projectId),
      dirty: true,
      running: current?.running ?? false,
      sessionId: String(lane.session.header.sessionId),
      clientId: String(clientId),
      lastDailyAppendAt: this.#now(),
      lastDailyPath: dailyPath,
      lastFailure: current?.lastFailure,
      lastSuccessAt: current?.lastSuccessAt,
      lastProjectMemoryUpdateAt: current?.lastProjectMemoryUpdateAt,
      lastRootMemoryUpdateAt: current?.lastRootMemoryUpdateAt,
    });
  }

  async #runIdleMemoryDream(projectId: ProjectId): Promise<void> {
    const schedule = this.#memoryDreams.get(projectId);
    if (!schedule || schedule.running) {
      return;
    }
    schedule.running = true;
    schedule.timer = undefined;
    this.#memoryDreams.set(projectId, schedule);
    const beforeRun = await readMemoryDreamState({
      projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    await this.#writeMemoryDreamState(projectId, {
      ...(beforeRun ?? { projectId: String(projectId), dirty: true }),
      projectId: String(projectId),
      running: true,
      lastAttemptAt: this.#now(),
    });
    try {
      const lane = await this.#getLane(schedule.sessionId);
      const memory = await this.#safeMemorySettingsForRuntime(lane, schedule.clientId);
      if (!memory.enabled || !memory.autoDream) {
        await this.#writeMemoryDreamState(projectId, {
          ...(beforeRun ?? { projectId: String(projectId) }),
          projectId: String(projectId),
          dirty: false,
          running: false,
          lastFailure: { at: this.#now(), message: "Memory dream disabled" },
        });
        return;
      }
      const generated = await this.#generateMemoryUpdate(lane, memory);
      const paths = scorelMemoryPaths({
        projectId: lane.project.projectId,
        homeDir: this.#memoryHomeDir,
        now: this.#now,
      });
      if (generated?.projectMemory?.trim()) {
        await writeFile(paths.projectMemoryPath, normalizeMarkdownFile(generated.projectMemory), "utf8");
        await this.#appendDiagnostic(lane.session.header.sessionId, "project_memory_updated", {
          clientId: schedule.clientId,
          path: paths.projectMemoryPath,
        });
      }
      if (memory.promoteRoot && generated?.rootMemory?.trim()) {
        await writeFile(paths.rootMemoryPath, normalizeMarkdownFile(generated.rootMemory), "utf8");
        await this.#appendDiagnostic(lane.session.header.sessionId, "root_memory_updated", {
          clientId: schedule.clientId,
          path: paths.rootMemoryPath,
        });
      }
      const now = this.#now();
      const latestState = await readMemoryDreamState({ projectId, homeDir: this.#memoryHomeDir, now: this.#now });
      const hasNewDailyDuringRun =
        latestState?.lastDailyAppendAt !== undefined &&
        beforeRun?.lastDailyAppendAt !== undefined &&
        latestState.lastDailyAppendAt > beforeRun.lastDailyAppendAt;
      await this.#writeMemoryDreamState(projectId, {
        ...(latestState ?? { projectId: String(projectId) }),
        projectId: String(projectId),
        dirty: hasNewDailyDuringRun,
        running: false,
        ...(hasNewDailyDuringRun ? {} : { scheduledFor: undefined }),
        lastSuccessAt: now,
        lastFailure: undefined,
        ...(generated?.projectMemory?.trim() ? { lastProjectMemoryUpdateAt: now } : {}),
        ...(memory.promoteRoot && generated?.rootMemory?.trim() ? { lastRootMemoryUpdateAt: now } : {}),
      });
      if (hasNewDailyDuringRun) {
        await this.#scheduleMemoryDream(lane, schedule.clientId);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.#writeMemoryDreamState(projectId, {
        ...(await readMemoryDreamState({ projectId, homeDir: this.#memoryHomeDir, now: this.#now }) ?? { projectId: String(projectId) }),
        projectId: String(projectId),
        dirty: true,
        running: false,
        lastFailure: { at: this.#now(), message },
      });
      throw cause;
    } finally {
      this.#memoryDreams.delete(projectId);
    }
  }

  async #memoryStatusForProject(projectId: ProjectId): Promise<MemoryStatus> {
    const state = await readMemoryDreamState({
      projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    await this.#recoverMemoryDream(projectId, state);
    const recovered = await readMemoryDreamState({
      projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    return {
      projectId,
      dirty: recovered?.dirty ?? false,
      running: recovered?.running ?? false,
      ...(recovered?.lastDailyAppendAt !== undefined ? { lastDailyAppendAt: recovered.lastDailyAppendAt } : {}),
      ...(recovered?.lastDailyPath ? { lastDailyPath: recovered.lastDailyPath } : {}),
      ...(recovered?.scheduledFor !== undefined ? { scheduledFor: recovered.scheduledFor } : {}),
      ...(recovered?.lastAttemptAt !== undefined ? { lastAttemptAt: recovered.lastAttemptAt } : {}),
      ...(recovered?.lastSuccessAt !== undefined ? { lastSuccessAt: recovered.lastSuccessAt } : {}),
      ...(recovered?.lastFailure ? { lastFailure: recovered.lastFailure } : {}),
      ...(recovered?.lastProjectMemoryUpdateAt !== undefined ? { lastProjectMemoryUpdateAt: recovered.lastProjectMemoryUpdateAt } : {}),
      ...(recovered?.lastRootMemoryUpdateAt !== undefined ? { lastRootMemoryUpdateAt: recovered.lastRootMemoryUpdateAt } : {}),
    };
  }

  async #recoverMemoryDream(projectId: ProjectId, state: Awaited<ReturnType<typeof readMemoryDreamState>>): Promise<void> {
    if (!state?.dirty || this.#memoryDreams.has(projectId)) {
      return;
    }
    const lane = [...this.#sessions.values()].find((candidate) => candidate.project.projectId === projectId);
    if (!lane) {
      return;
    }
    const clientId = state.clientId ? asClientId(state.clientId) : asClientId("client_memory_recovery");
    await this.#scheduleMemoryDream(lane, clientId);
  }

  async #writeMemoryDreamState(projectId: ProjectId, state: Parameters<typeof writeMemoryDreamState>[0]["state"]): Promise<void> {
    await writeMemoryDreamState({
      projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
      state,
    });
  }

  async #generateMemoryUpdate(
    lane: SessionLane,
    memory: MemorySettings,
  ): Promise<{ projectMemory?: string; rootMemory?: string } | undefined> {
    const selectedModel = await this.#selectedModelFromMeta(
      { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
      lane.project,
    );
    if (!selectedModel) {
      return undefined;
    }
    const context = await buildMemoryContext({
      projectId: lane.project.projectId,
      homeDir: this.#memoryHomeDir,
      now: this.#now,
    });
    const runtime = await this.#createRuntime({
      sessionId: lane.session.header.sessionId,
      project: lane.project,
      selectedModel,
      purpose: "memory",
    });
    let raw = "";
    for await (const rawEvent of runtime.executeTurn(
      [{
        role: "user",
        content: [{
          type: "text",
          text: [
            "Consolidate Scorel filesystem memory from recent project daily notes.",
            "Return only strict JSON with optional keys: projectMemory, rootMemory.",
            "projectMemory: full replacement markdown for Project MEMORY.md, only durable project preferences/decisions/workflows/open questions.",
            memory.promoteRoot
              ? "rootMemory: full replacement markdown for root MEMORY.md, only cross-project stable user preferences. Omit if no global preference."
              : "Do not return rootMemory.",
            "Do not store secrets, transient tool noise, or code facts that can be read from the repo.",
            "Use daily notes as recent evidence, but only promote stable facts and decisions into memory.",
            "",
            "<root_memory>",
            context.rootMemory,
            "</root_memory>",
            "<project_memory>",
            context.projectMemory,
            "</project_memory>",
            "<recent_daily>",
            context.yesterdayDaily,
            "",
            context.todayDaily,
            "</recent_daily>",
          ].join("\n"),
        }],
      }],
      "You are Scorel's automatic memory dreamer. Output strict JSON only.",
      {},
    )) {
      if (rawEvent.type === "text_delta") {
        raw += rawEvent.delta;
      } else if (rawEvent.type === "message_end") {
        raw = assistantText(rawEvent.message) || raw;
      } else if (rawEvent.type === "error") {
        throw rawEvent.error;
      }
    }
    return parseMemoryUpdate(raw);
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
    const runtime = await this.#createRuntime({
      sessionId,
      project,
      selectedModel,
      purpose: "chat",
      backgroundBash: this.#backgroundBashForSession(sessionId),
    });
    await this.#appendDiagnostic(sessionId, "runtime_created", {
      projectId: project.projectId,
      workDir: project.workDir,
      selectedModelId: selectedModel?.modelId,
    });
    const lane = {
      session: loaded,
      project,
      runtime,
      ...(selectedModel ? { selectedModel } : {}),
      queue: Promise.resolve(),
      appendQueue: Promise.resolve(),
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
    const runtime = await this.#createRuntime({
      sessionId,
      project,
      selectedModel,
      purpose: "chat",
      backgroundBash: this.#backgroundBashForSession(sessionId),
    });
    await this.#appendDiagnostic(sessionId, "runtime_created", {
      projectId: project.projectId,
      workDir: project.workDir,
      selectedModelId: selectedModel?.modelId,
    });
    const lane = {
      session,
      project,
      runtime,
      ...(selectedModel ? { selectedModel } : {}),
      queue: Promise.resolve(),
      appendQueue: Promise.resolve(),
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
    lane.runtime.registerTool(
      createSnipTool({
        snip: async (input) => this.#snipUserTurn(lane, input.userMessageId, input.reason),
      }),
    );
  }

  async #snipUserTurn(
    lane: SessionLane,
    userMessageId: string,
    reason: string | undefined,
  ): Promise<{ anchorUserEventId: EventId; throughEventId: EventId; hiddenEventCount: number }> {
    const leafId = lane.session.activeLeafId;
    if (!leafId) {
      throw new Error("snip requires an active conversation");
    }
    const path = lane.session.tree.getPath(leafId);
    const anchorUserEventId = this.#resolveSnipUserMessageId(lane, path, userMessageId);
    const anchorIndex = path.findIndex((id) => id === anchorUserEventId);
    if (anchorIndex < 0) {
      throw new Error(`snip target is not on the active conversation path: ${anchorUserEventId}`);
    }
    const anchor = lane.session.tree.get(anchorUserEventId)?.event;
    if (anchor?.type !== "user_message") {
      throw new Error(`snip target must be a user_message: ${anchorUserEventId}`);
    }
    const nextUserIndex = path.findIndex((id, index) =>
      index > anchorIndex && lane.session.tree.get(id)?.event.type === "user_message"
    );
    if (nextUserIndex < 0) {
      throw new Error("snip cannot hide the current user turn before the next user message exists");
    }
    const throughEventId = path[nextUserIndex - 1];
    if (!throughEventId || throughEventId === anchorUserEventId) {
      throw new Error(`snip target has no completed turn content: ${anchorUserEventId}`);
    }
    const clientId = lane.snipClientId;
    if (!clientId) {
      throw new Error("snip is only available while a user turn is running");
    }
    await this.#appendPersistent(lane, {
      type: "context_control",
      id: asEventId(this.#createId()),
      parentId: null,
      sessionId: lane.session.header.sessionId,
      clientId,
      ts: this.#now(),
      operation: "hide_user_turn",
      anchorUserEventId,
      throughEventId,
      actor: "agent",
      ...(reason ? { reason } : {}),
    });
    await this.#appendDiagnostic(lane.session.header.sessionId, "context_snipped", {
      anchorUserEventId,
      throughEventId,
      hiddenEventCount: nextUserIndex - anchorIndex,
    });
    return {
      anchorUserEventId,
      throughEventId,
      hiddenEventCount: nextUserIndex - anchorIndex,
    };
  }

  #resolveSnipUserMessageId(lane: SessionLane, path: EventId[], userMessageId: string): EventId {
    if (path.includes(userMessageId as EventId)) {
      return userMessageId as EventId;
    }
    const matches = path.filter((id) => {
      const event = lane.session.tree.get(id)?.event;
      return event?.type === "user_message" && snipUserMessageAlias(id) === userMessageId;
    });
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      throw new Error(`snip target short id is ambiguous: ${userMessageId}`);
    }
    return asEventId(userMessageId);
  }

  async #selectChatRuntime(lane: SessionLane, modelSelection: ModelSelectionInput | undefined): Promise<void> {
    if (!modelSelection) {
      return;
    }
    const selectedModel = await this.#selectedModelFromMeta(
      { projectId: lane.project.projectId, modelSelection },
      lane.project,
    );
    if (!selectedModel || lane.selectedModel?.modelId === selectedModel.modelId) {
      return;
    }
    lane.runtime = await this.#createRuntime({
      sessionId: lane.session.header.sessionId,
      project: lane.project,
      selectedModel,
      purpose: "chat",
      backgroundBash: this.#backgroundBashForSession(lane.session.header.sessionId),
    });
    lane.selectedModel = selectedModel;
    this.#registerLaneTools(lane);
    await this.#appendDiagnostic(lane.session.header.sessionId, "chat_model_selected", {
      projectId: lane.project.projectId,
      workDir: lane.project.workDir,
      selectedModelId: selectedModel.modelId,
      role: selectedModel.role,
    });
  }

  #syncChannelTool(lane: SessionLane, channelContext: RuntimeChannelContext | undefined): void {
    if (!channelContext) {
      lane.runtime.unregisterTool("SendChannelMessage");
      return;
    }
    lane.runtime.registerTool(
      createSendChannelMessageTool({
        sendCurrent: async (input) => {
          const current = lane.channelContext;
          if (!current) {
            throw new Error("no_channel_context");
          }
          if (input.channel && input.channel !== current.channel) {
            throw new Error(`channel_mismatch: current channel is ${current.channel}`);
          }
          const extension = this.#imExtensions.get(current.extensionId);
          if (!extension) {
            throw new Error(`channel_adapter_unavailable: ${current.extensionId}`);
          }
          await extension.adapter.sendMessage(current.target, {
            ...(input.text ? { text: input.text } : {}),
            ...(input.attachments ? { attachments: input.attachments } : {}),
          });
          await this.#appendDiagnostic(lane.session.header.sessionId, "channel_message_sent", {
            extensionId: current.extensionId,
            channel: current.channel,
            externalConversationId: current.externalConversationId,
            attachments: input.attachments?.length ?? 0,
          });
          return { channel: current.channel, target: "current", attachments: input.attachments?.length ?? 0 };
        },
      }),
    );
  }

  async #startEnabledImExtensions(): Promise<void> {
    const config = await this.#loadUserConfigProfile();
    const enabled = Object.entries(config?.extensions ?? {})
      .filter(([, extension]) => extension.enabled && extension.kind === "im")
      .map(([extensionId]) => extensionId);
    if (enabled.length === 0) {
      return;
    }
    const manifests = await this.#discoverExtensionManifests();
    for (const extensionId of enabled) {
      const manifest = manifests.get(extensionId);
      if (!manifest) {
        await this.#appendHostDiagnostic("im_extension_missing", { extensionId });
        continue;
      }
      let adapter: ImAdapter;
      try {
        adapter = await this.#loadImAdapter(manifest, config?.extensions[extensionId]?.config ?? {});
      } catch (cause) {
        await this.#appendHostDiagnostic("im_extension_load_failed", {
          extensionId,
          message: cause instanceof Error ? cause.message : String(cause),
        });
        continue;
      }
      const extension: LoadedImExtension = {
        manifest,
        adapter,
        skillRoots: manifest.skills.map((path) => resolve(manifest.rootDir, path)),
      };
      let started = false;
      await adapter.start({
        onMessage: async (message) => {
          await this.#handleImMessage(extension, message);
        },
        logger: {
          info: (message, data) => void this.#appendHostDiagnostic("im_extension_info", { extensionId, message, ...data }),
          error: (message, data) => void this.#appendHostDiagnostic("im_extension_error", { extensionId, message, ...data }),
        },
      }).then(() => {
        started = true;
      }).catch(async (cause) => {
        await this.#appendHostDiagnostic("im_extension_start_failed", {
          extensionId,
          message: cause instanceof Error ? cause.message : String(cause),
        });
        return undefined;
      });
      if (!started) {
        continue;
      }
      this.#imExtensions.set(extensionId, extension);
      await this.#appendHostDiagnostic("im_extension_started", { extensionId });
    }
  }

  async #stopImExtensions(): Promise<void> {
    for (const extension of this.#imExtensions.values()) {
      await extension.adapter.stop().catch((cause) => {
        void this.#appendHostDiagnostic("im_extension_stop_failed", {
          extensionId: extension.manifest.id,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    }
    this.#imExtensions.clear();
  }

  async #discoverExtensionManifests(): Promise<Map<string, ExtensionManifest>> {
    const roots = [
      this.#builtinExtensionsDir,
      join(this.#scorelHomeDir, "extensions"),
    ];
    const manifests = new Map<string, ExtensionManifest>();
    for (const root of roots) {
      let children: string[];
      try {
        children = await readdir(root);
      } catch (cause) {
        if (isNodeErrorCode(cause, "ENOENT") || isNodeErrorCode(cause, "ENOTDIR")) {
          continue;
        }
        throw cause;
      }
      for (const child of children.sort()) {
        const manifestPath = join(root, child, "scorel.extension.json");
        try {
          const manifest = await loadExtensionManifest(manifestPath);
          manifests.set(manifest.id, manifest);
        } catch (cause) {
          await this.#appendHostDiagnostic("extension_manifest_invalid", {
            path: manifestPath,
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    }
    return manifests;
  }

  async #loadImAdapter(manifest: ExtensionManifest, config: Record<string, string | number | boolean>): Promise<ImAdapter> {
    const adapterPath = resolve(manifest.rootDir, manifest.adapter);
    const mod = await import(pathToFileURL(adapterPath).href) as {
      createAdapter?: (options: { config: Record<string, string | number | boolean>; manifest: ExtensionManifest }) => ImAdapter | Promise<ImAdapter>;
      default?: ImAdapter;
    };
    const adapter = mod.createAdapter ? await mod.createAdapter({ config, manifest }) : mod.default;
    if (!adapter || typeof adapter.start !== "function" || typeof adapter.stop !== "function" || typeof adapter.sendMessage !== "function") {
      throw new Error(`IM adapter ${adapterPath} must export createAdapter() or default adapter with start/stop/sendMessage`);
    }
    return adapter;
  }

  async #handleImMessage(extension: LoadedImExtension, message: ImIncomingMessage): Promise<SessionId> {
    const binding = await this.#ensureImBinding(extension.manifest.id, message.externalConversationId);
    const lane = await this.#getLane(binding.sessionId);
    const runningBehavior = isSteerMessage(message.text) ? "steer" : "follow_up";
    const content = stripImCommandPrefix(message.text);
    const channelContext: ChannelContext = {
      channel: extension.manifest.id,
      externalConversationId: message.externalConversationId,
      ...(message.conversationType ? { conversationType: message.conversationType } : {}),
      ...(message.senderDisplayName ? { senderDisplayName: message.senderDisplayName } : {}),
      ...(message.mentionedBot !== undefined ? { mentionedBot: message.mentionedBot } : {}),
      data: message.target?.data ?? message.data ?? {},
    };
    await this.#handleSendMessage(
      { clientId: asClientId(`im_${extension.manifest.id}`), emit: () => undefined },
      {
        type: "send_message",
        requestId: asRequestId(`req_im_${this.#createId()}`),
        sessionId: lane.session.header.sessionId,
        content,
        options: {
          runningBehavior,
          channelContext,
        },
      },
    );
    return lane.session.header.sessionId;
  }

  async #ensureImBinding(extensionId: string, externalConversationId: string): Promise<ImSessionBinding> {
    const key = imBindingKey(extensionId, externalConversationId);
    const existing = this.#imBindings.get(key);
    if (existing) {
      existing.updatedAt = this.#now();
      await this.#saveImBindings();
      return existing;
    }
    const project = await this.#ensureDefaultWorkspaceProject();
    const sessionId = asSessionId(`ses_${this.#createId()}`);
    const lane = await this.#createLane(sessionId, {
      projectId: project.projectId,
      title: `${extensionId}: ${externalConversationId}`,
    }, project);
    this.#sessions.set(sessionId, lane);
    this.#events.set(sessionId, []);
    this.#seqs.set(sessionId, 0);
    const binding: ImSessionBinding = {
      extensionId,
      externalConversationId,
      projectId: project.projectId,
      sessionId,
      createdAt: this.#now(),
      updatedAt: this.#now(),
    };
    this.#imBindings.set(key, binding);
    await this.#saveImBindings();
    await this.#appendDiagnostic(sessionId, "im_session_bound", {
      extensionId,
      externalConversationId,
      projectId: project.projectId,
    });
    this.#onSessionListChanged?.({ projectId: project.projectId, sessionId });
    return binding;
  }

  async #ensureDefaultWorkspaceProject(): Promise<HostProject> {
    const workspace = join(this.#scorelHomeDir, "workspace");
    await mkdir(workspace, { recursive: true });
    return this.registerProject(workspace);
  }

  #extensionSkillRoots(): Array<{ path: string; extensionId: string }> {
    return [...this.#imExtensions.values()].flatMap((extension) =>
      extension.skillRoots.map((path) => ({ path, extensionId: extension.manifest.id })),
    );
  }

  async #loadImBindings(): Promise<void> {
    try {
      const text = await readFile(this.#imBindingsPath(), "utf8");
      const value = JSON.parse(text) as { bindings?: ImSessionBinding[] };
      for (const binding of value.bindings ?? []) {
        this.#imBindings.set(imBindingKey(binding.extensionId, binding.externalConversationId), binding);
      }
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
  }

  async #saveImBindings(): Promise<void> {
    const path = this.#imBindingsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ bindings: [...this.#imBindings.values()] }, null, 2)}\n`, "utf8");
  }

  #imBindingsPath(): string {
    return join(this.#scorelHomeDir, "channels", "im-bindings.json");
  }

  async #loadUserConfigProfile(options: { includeSecrets?: boolean } = {}): Promise<ScorelConfigProfile | undefined> {
    try {
      return await loadScorelConfigProfile({
        cwd: this.#userHomeDir,
        scorelHomeDir: this.#scorelHomeDir,
        includeSecrets: options.includeSecrets ?? false,
      });
    } catch (cause) {
      if (isMissingConfigError(cause)) {
        return undefined;
      }
      throw cause;
    }
  }

  #configWriteTarget(): {
    configDir: string;
    configPath: string;
    workDir: string;
  } {
    return {
      configDir: this.#scorelHomeDir,
      configPath: join(this.#scorelHomeDir, "config.toml"),
      workDir: this.#userHomeDir,
    };
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
      config = projectId ? await this.#configProfileForProject(projectId) : await this.#loadUserConfigProfile();
    } catch (cause) {
      if (!isMissingConfigError(cause)) {
        throw cause;
      }
      config = undefined;
    }
    config ??= projectId ? undefined : this.#modelProfile;
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
    const target = this.#configWriteTarget();
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(target.configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(target.configDir, { recursive: true });
    await writeFile(
      target.configPath,
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
      ...(request.projectId ? { ignoredProjectId: request.projectId } : {}),
      scope: "device",
      workDir: target.workDir,
      providerId: request.providerId,
      modelId: request.modelId,
    });
    return this.#listModels();
  }

  async #handleRemoveModelProvider(
    request: ClientRequest<"remove_model_provider">,
  ): Promise<{
    providers: ProviderConnectionSummary[];
    providerModels: ProviderModelSummary[];
    models: AvailableModelSummary[];
    roles: Record<"primary" | "standard" | "auxiliary", string>;
    warnings?: string[];
    removed: boolean;
  }> {
    const target = this.#configWriteTarget();
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(target.configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(target.configDir, { recursive: true });
    await writeFile(
      target.configPath,
      renderModelProfileConfig({
        removeProviderId: request.providerId,
        existingConfigText,
      }),
      "utf8",
    );
    const profile = await this.#listModels();
    return { ...profile, removed: true };
  }

  async #memorySettingsForProject(projectId: ProjectId): Promise<MemorySettings> {
    return this.#memorySettings(projectId);
  }

  async #memorySettings(projectId?: ProjectId): Promise<MemorySettings> {
    const config = await (projectId ? this.#configProfileForProject(projectId) : this.#loadUserConfigProfile()).catch((cause) => {
      if (isMissingConfigError(cause)) {
        return undefined;
      }
      throw cause;
    });
    return config?.memory ?? disabledMemorySettings();
  }

  async #safeMemorySettingsForRuntime(lane: SessionLane, clientId: ClientId): Promise<MemorySettings> {
    try {
      return await this.#memorySettingsForProject(lane.project.projectId);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.#appendDiagnostic(lane.session.header.sessionId, "memory_settings_unavailable", {
        clientId,
        message: error.message,
        stack: shortStack(error),
      });
      return disabledMemorySettings();
    }
  }

  async #handleUpsertMemorySettings(request: ClientRequest<"upsert_memory_settings">): Promise<MemorySettings> {
    const target = this.#configWriteTarget();
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(target.configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(target.configDir, { recursive: true });
    await writeFile(
      target.configPath,
      renderMemoryConfig({
        enabled: request.enabled,
        daily: request.daily,
        sessionMemory: request.sessionMemory,
        autoDream: request.autoDream,
        promoteRoot: request.promoteRoot,
        dreamIdleMinutes: request.dreamIdleMinutes,
        autoCompactThreshold: request.autoCompactThreshold,
        existingConfigText,
      }),
      "utf8",
    );
    await this.#appendHostDiagnostic("memory_settings_upserted", {
      ...(request.projectId ? { ignoredProjectId: request.projectId } : {}),
      scope: "device",
      workDir: target.workDir,
    });
    return this.#memorySettings();
  }

  async #runtimeSettingsForProject(projectId: ProjectId, installStatus?: Pick<RuntimeSettings, "installStatus" | "installMessage">): Promise<RuntimeSettings> {
    return this.#runtimeSettings(projectId, installStatus);
  }

  async #runtimeSettings(projectId?: ProjectId, installStatus?: Pick<RuntimeSettings, "installStatus" | "installMessage">): Promise<RuntimeSettings> {
    const config = await (projectId ? this.#configProfileForProject(projectId) : this.#loadUserConfigProfile()).catch((cause) => {
      if (isMissingConfigError(cause)) {
        return undefined;
      }
      throw cause;
    });
    const detected = await detectRtk();
    const savings = await readRuntimeStats(this.#runtimeStatsPath());
    return {
      tokenSavingRtk: config?.runtime.tokenSavingRtk ?? false,
      rtkAvailable: detected.available,
      ...(detected.executable ? { rtkExecutable: detected.executable } : {}),
      ...(detected.version ? { rtkVersion: detected.version } : {}),
      ...(installStatus?.installStatus ? { installStatus: installStatus.installStatus } : {}),
      ...(installStatus?.installMessage ? { installMessage: installStatus.installMessage } : {}),
      estimatedOutputTokens: savings.rtk.outputTokens,
      estimatedSavedTokens: savings.rtk.savedTokens,
    };
  }

  async #handleUpsertRuntimeSettings(request: ClientRequest<"upsert_runtime_settings">): Promise<RuntimeSettings> {
    const target = this.#configWriteTarget();
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(target.configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(target.configDir, { recursive: true });
    await writeFile(
      target.configPath,
      renderRuntimeConfig({
        tokenSavingRtk: request.tokenSavingRtk,
        existingConfigText,
      }),
      "utf8",
    );
    const installResult = request.tokenSavingRtk === true ? await ensureRtkAvailable() : { status: "idle" as const };
    await this.#appendHostDiagnostic("runtime_settings_upserted", {
      ...(request.projectId ? { ignoredProjectId: request.projectId } : {}),
      scope: "device",
      workDir: target.workDir,
      tokenSavingRtk: request.tokenSavingRtk,
      installStatus: installResult.status,
    });
    return this.#runtimeSettings(undefined, {
      installStatus: installResult.status,
      ...(installResult.message ? { installMessage: installResult.message } : {}),
    });
  }

  async #observabilitySettings(projectId?: ProjectId): Promise<ObservabilitySettings> {
    const config = await (projectId ? this.#configProfileForProject(projectId) : this.#loadUserConfigProfile()).catch((cause) => {
      if (isMissingConfigError(cause)) {
        return undefined;
      }
      throw cause;
    });
    return config?.observability ?? {
      local: true,
      sync: {
        enabled: false,
        mode: "manual",
        targets: [],
      },
      langfuse: {
        enabled: false,
      },
      otel: {
        enabled: false,
        protocol: "otlp-http",
      },
    };
  }

  async #handleUpsertObservabilitySettings(request: ClientRequest<"upsert_observability_settings">): Promise<ObservabilitySettings> {
    const target = this.#configWriteTarget();
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(target.configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(target.configDir, { recursive: true });
    await writeFile(
      target.configPath,
      renderObservabilityConfig({
        local: request.local,
        sync: request.sync,
        langfuse: request.langfuse,
        otel: request.otel,
        existingConfigText,
      }),
      "utf8",
    );
    await this.#appendHostDiagnostic("observability_settings_upserted", {
      ...(request.projectId ? { ignoredProjectId: request.projectId } : {}),
      scope: "device",
      workDir: target.workDir,
      syncEnabled: request.sync?.enabled,
      targets: request.sync?.targets?.join(","),
      langfuseEnabled: request.langfuse?.enabled,
      otelEnabled: request.otel?.enabled,
    });
    return this.#observabilitySettings();
  }

  async #extensionSettings(extensionId: string): Promise<ExtensionSettings> {
    const config = await this.#loadUserConfigProfile().catch((cause) => {
      if (isMissingConfigError(cause)) {
        return undefined;
      }
      throw cause;
    });
    const extension = config?.extensions[extensionId];
    return {
      extensionId,
      enabled: extension?.enabled ?? false,
      kind: "im",
      config: extension?.config ?? {},
      active: this.#imExtensions.has(extensionId),
    };
  }

  async #handleUpsertExtensionSettings(request: ClientRequest<"upsert_extension_settings">): Promise<ExtensionSettings> {
    const configPath = join(this.#scorelHomeDir, "config.toml");
    let existingConfigText: string | undefined;
    try {
      existingConfigText = await readFile(configPath, "utf8");
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT")) {
        throw cause;
      }
    }
    await mkdir(this.#scorelHomeDir, { recursive: true });
    await writeFile(
      configPath,
      renderExtensionConfig({
        extensionId: request.extensionId,
        enabled: request.enabled,
        kind: request.kind,
        config: request.config,
        existingConfigText,
      }),
      "utf8",
    );
    await this.#appendHostDiagnostic("extension_settings_upserted", {
      extensionId: request.extensionId,
      enabled: request.enabled,
    });
    await this.refreshImExtensions();
    return this.#extensionSettings(request.extensionId);
  }

  async #fetchProviderModels(projectId: ProjectId | undefined, providerId: string): Promise<ProviderCatalogModelSummary[]> {
    const config = projectId
      ? await loadScorelConfigProfile({
        cwd: (await this.#registry.require(projectId)).workDir,
        scorelHomeDir: this.#scorelHomeDir,
        includeSecrets: true,
      })
      : await this.#loadUserConfigProfile({ includeSecrets: true });
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
    const selectionInput = persistedSelection
      ? config.models[persistedSelection.modelId]
        ? { modelId: persistedSelection.modelId, role: persistedSelection.role }
        : persistedSelection.role
          ? { role: persistedSelection.role }
          : undefined
      : requestedSelection;
    const selection = resolveModelSelection(
      config,
      selectionInput,
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
        return await loadScorelConfigProfile({ cwd: project.workDir, scorelHomeDir: this.#scorelHomeDir });
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

  #runtimeStatsPath(): string {
    return join(this.#scorelHomeDir, "runtime-stats.json");
  }

  async #recordRtkSavings(input: { projectId: ProjectId; sessionId: SessionId; savings: RtkSavingsDelta }): Promise<void> {
    const updateTask = this.#runtimeStatsQueue.then(async () => {
      const path = this.#runtimeStatsPath();
      const stats = await readRuntimeStats(path);
      addRtkSavings(stats, String(input.projectId), String(input.sessionId), input.savings);
      await writeRuntimeStats(path, stats);
    });
    this.#runtimeStatsQueue = updateTask.catch(() => {});
    await updateTask;
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

const snipUserMessageIdBlock = (userEventId: EventId): ScorelMessage["content"][number] => ({
  ...createSystemReminderBlock({
    kind: "message_ref",
    origin: "system",
    text: `snip.userMessageId: ${snipUserMessageAlias(userEventId)}`,
    visibility: "model",
    scope: "message",
    data: { userMessageId: snipUserMessageAlias(userEventId) },
  }),
});

const inputText = (message: ScorelMessage): string =>
  message.content
    .flatMap((block) => block.type === "text" && block.visibility !== "model" ? [block.text] : [])
    .join("\n")
    .trim();

const assistantText = (message: ScorelMessage): string =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

const messageText = (message: ScorelMessage): string => {
  const text = message.content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "thinking") {
        return `[thinking] ${block.text}`;
      }
      if (block.type === "tool_call") {
        return `[tool_call:${block.toolName}] ${JSON.stringify(block.args)}`;
      }
      if (block.type === "tool_result") {
        return `[tool_result:${block.toolName}] ${JSON.stringify(block.result)}`;
      }
      if (block.type === "system_reminder") {
        return `[system_reminder:${block.kind}] ${block.text}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || "(empty)";
};

const toolResultText = (result: BackgroundBashCompletion["result"]): string => {
  const text = result.content
    .map((block) => block.type === "text" ? block.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || "(empty Bash result)";
};

const messageHasBackgroundBashReminder = (message: ScorelMessage, taskId: string): boolean =>
  message.content.some((block) => {
    if (block.type === "system_reminder") {
      return isBackgroundBashReminderData(block.data, taskId);
    }
    if (block.type !== "tool_result" || !isRecord(block.result) || !Array.isArray(block.result.content)) {
      return false;
    }
    return block.result.content.some((item) =>
      isRecord(item) &&
      item.type === "system_reminder" &&
      isBackgroundBashReminderData(item.data, taskId)
    );
  });

const isBackgroundBashReminderData = (value: unknown, taskId: string): boolean =>
  isRecord(value) && value.type === "background_bash_completed" && value.task_id === taskId;

const estimateScorelMessagesTokens = (messages: ScorelMessage[]): number =>
  estimateTextTokens(messages.map(messageText).join("\n"));

const estimateTextTokens = (value: string): number => Math.ceil(value.length / 3);

const compactLine = (value: string, maxChars: number): string =>
  value.replace(/\s+/g, " ").trim().slice(0, maxChars);

const parseSessionMemoryJson = (
  raw: string,
): { summary?: string; recentMessages?: string[]; decisions?: string[]; followUps?: string[] } | undefined => {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!text) {
    return undefined;
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    return undefined;
  }
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    recentMessages: stringArray(parsed.recentMessages),
    decisions: stringArray(parsed.decisions),
    followUps: stringArray(parsed.followUps),
  };
};

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

const disabledMemorySettings = (): MemorySettings => ({
  enabled: false,
  daily: false,
  sessionMemory: false,
  autoDream: false,
  promoteRoot: false,
  dreamIdleMinutes: 60,
  autoCompactThreshold: 0.8,
});

const detectRtk = async (): Promise<{ available: boolean; executable?: string; version?: string }> => {
  try {
    const shell = resolveDefaultShell();
    const path = (await execFileAsync(shell, shellCommandArgs(shell, "command -v rtk"), { timeout: 5_000 })).stdout.trim();
    if (!path) {
      return { available: false };
    }
    const version = await execFileAsync(path, ["--version"], { timeout: 5_000 })
      .then((result) => result.stdout.trim() || result.stderr.trim())
      .catch(() => undefined);
    return {
      available: true,
      executable: path,
      ...(version ? { version } : {}),
    };
  } catch {
    return { available: false };
  }
};

const ensureRtkAvailable = async (): Promise<{ status: "idle" | "installed" | "failed"; message?: string }> => {
  const existing = await detectRtk();
  if (existing.available) {
    return { status: "installed", message: existing.version ?? existing.executable };
  }
  const shell = resolveDefaultShell();
  const brew = await execFileAsync(shell, shellCommandArgs(shell, "command -v brew"), { timeout: 5_000 })
    .then((result) => result.stdout.trim())
    .catch(() => "");
  if (!brew) {
    return { status: "failed", message: "Homebrew is not available; install RTK manually with `brew install rtk`." };
  }
  try {
    await execFileAsync(brew, ["install", "rtk"], { timeout: 120_000, maxBuffer: 20_000_000 });
    const installed = await detectRtk();
    return installed.available
      ? { status: "installed", message: installed.version ?? installed.executable }
      : { status: "failed", message: "RTK install finished but `rtk` is still not on PATH." };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { status: "failed", message };
  }
};

type RtkSavingsDelta = {
  outputTokens: number;
  savedTokens: number;
};

type RuntimeStatsBucket = RtkSavingsDelta;

type RuntimeStats = {
  version: 1;
  rtk: RuntimeStatsBucket & {
    byProject: Record<string, RuntimeStatsBucket>;
    bySession: Record<string, RuntimeStatsBucket>;
  };
};

const emptyRuntimeStats = (): RuntimeStats => ({
  version: 1,
  rtk: {
    outputTokens: 0,
    savedTokens: 0,
    byProject: {},
    bySession: {},
  },
});

const readRuntimeStats = async (path: string): Promise<RuntimeStats> => {
  try {
    return parseRuntimeStats(JSON.parse(await readFile(path, "utf8")));
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT")) {
      return emptyRuntimeStats();
    }
    return emptyRuntimeStats();
  }
};

const writeRuntimeStats = async (path: string, stats: RuntimeStats): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.runtime-stats-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  } catch (cause) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw cause;
  }
};

const parseRuntimeStats = (value: unknown): RuntimeStats => {
  if (!isRecord(value) || !isRecord(value.rtk)) {
    return emptyRuntimeStats();
  }
  return {
    version: 1,
    rtk: {
      outputTokens: nonNegativeInteger(value.rtk.outputTokens),
      savedTokens: nonNegativeInteger(value.rtk.savedTokens),
      byProject: parseRuntimeStatsBuckets(value.rtk.byProject),
      bySession: parseRuntimeStatsBuckets(value.rtk.bySession),
    },
  };
};

const parseRuntimeStatsBuckets = (value: unknown): Record<string, RuntimeStatsBucket> => {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, bucket]) => [
      key,
      isRecord(bucket)
        ? {
            outputTokens: nonNegativeInteger(bucket.outputTokens),
            savedTokens: nonNegativeInteger(bucket.savedTokens),
          }
        : { outputTokens: 0, savedTokens: 0 },
    ]),
  );
};

const addRtkSavings = (stats: RuntimeStats, projectId: string, sessionId: string, savings: RtkSavingsDelta): void => {
  addRuntimeStatsBucket(stats.rtk, savings);
  stats.rtk.byProject[projectId] = addRuntimeStatsBucket(stats.rtk.byProject[projectId] ?? { outputTokens: 0, savedTokens: 0 }, savings);
  stats.rtk.bySession[sessionId] = addRuntimeStatsBucket(stats.rtk.bySession[sessionId] ?? { outputTokens: 0, savedTokens: 0 }, savings);
};

const addRuntimeStatsBucket = <T extends RuntimeStatsBucket>(bucket: T, savings: RtkSavingsDelta): T => {
  bucket.outputTokens += savings.outputTokens;
  bucket.savedTokens += savings.savedTokens;
  return bucket;
};

const rtkSavingsFromToolResult = (result: unknown): RtkSavingsDelta | undefined => {
  if (!isRecord(result) || !isRecord(result.details)) {
    return undefined;
  }
  const rtk = result.details.rtk;
  if (!isRecord(rtk) || rtk.applied !== true) {
    return undefined;
  }
  const outputTokens = nonNegativeInteger(rtk.estimatedOutputTokens);
  const savedTokens = nonNegativeInteger(rtk.estimatedSavedTokens);
  return outputTokens > 0 || savedTokens > 0 ? { outputTokens, savedTokens } : undefined;
};

const nonNegativeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
};

const resolveDefaultShell = (): string => {
  const shell = process.env.SHELL || userShell() || "/bin/sh";
  return shell.trim() || "/bin/sh";
};

const shellCommandArgs = (shell: string, command: string): string[] => {
  const name = basename(shell).toLowerCase();
  if (name === "csh" || name === "tcsh" || name === "fish") {
    return ["-c", command];
  }
  return ["-lc", command];
};

const userShell = (): string | undefined => {
  try {
    return userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
};

const runtimeChannelContextFromWire = (context: ChannelContext): RuntimeChannelContext => ({
  extensionId: context.channel,
  channel: context.channel,
  externalConversationId: context.externalConversationId,
  target: {
    externalConversationId: context.externalConversationId,
    data: context.data,
  },
  ...(context.conversationType ? { conversationType: context.conversationType } : {}),
  ...(context.senderDisplayName ? { senderDisplayName: context.senderDisplayName } : {}),
  ...(context.mentionedBot !== undefined ? { mentionedBot: context.mentionedBot } : {}),
  ...(context.data ? { data: context.data } : {}),
});

const parseQueuedChannelContext = (value: unknown): RuntimeChannelContext | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.channel !== "string" || typeof value.externalConversationId !== "string") {
    return undefined;
  }
  return runtimeChannelContextFromWire({
    channel: value.channel,
    externalConversationId: value.externalConversationId,
    ...(typeof value.conversationType === "string" ? { conversationType: value.conversationType } : {}),
    ...(typeof value.senderDisplayName === "string" ? { senderDisplayName: value.senderDisplayName } : {}),
    ...(typeof value.mentionedBot === "boolean" ? { mentionedBot: value.mentionedBot } : {}),
    ...(isRecord(value.data) ? { data: value.data } : {}),
  });
};

const parseQueuedModelSelection = (value: unknown): ModelSelectionInput | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const selection: ModelSelectionInput = {};
  if (typeof value.modelId === "string") {
    selection.modelId = value.modelId;
  }
  if (value.role === "primary" || value.role === "standard" || value.role === "auxiliary") {
    selection.role = value.role;
  }
  return selection.modelId || selection.role ? selection : undefined;
};

const imBindingKey = (extensionId: string, externalConversationId: string): string =>
  `${extensionId}:${externalConversationId}`;

const defaultBuiltinExtensionsDir = (): string =>
  findBuiltinExtensionsDir([
    runtimeModuleDir(),
    process.cwd(),
  ]);

const runtimeModuleDir = (): string => {
  if (typeof __dirname === "string") {
    return __dirname;
  }
  return process.argv[1] ? dirname(process.argv[1]) : process.cwd();
};

const findBuiltinExtensionsDir = (starts: string[]): string => {
  for (const start of starts) {
    let current = resolve(start);
    while (true) {
      const candidate = join(current, "extensions", "builtin");
      if (existsSync(candidate)) {
        return candidate;
      }
      const next = dirname(current);
      if (next === current) {
        break;
      }
      current = next;
    }
  }
  return join(starts[0] ?? process.cwd(), "extensions", "builtin");
};

const isSteerMessage = (text: string): boolean =>
  /^\/(?:steer|interrupt)\b/i.test(text.trim());

const stripImCommandPrefix = (text: string): string =>
  text.trim().replace(/^\/(?:steer|interrupt)\s*/i, "").trim() || text;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseMemoryUpdate = (raw: string): { projectMemory?: string; rootMemory?: string } | undefined => {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!text) {
    return undefined;
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record.projectMemory === "string" && record.projectMemory.trim() ? { projectMemory: record.projectMemory.trim() } : {}),
    ...(typeof record.rootMemory === "string" && record.rootMemory.trim() ? { rootMemory: record.rootMemory.trim() } : {}),
  };
};

const normalizeMarkdownFile = (value: string): string => `${value.trimEnd()}\n`;

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
