#!/usr/bin/env -S node --import tsx
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { basename, dirname, join, relative, resolve } from "node:path";

import { DaemonClient, WsTransport, clientPackageName } from "@scorel/client";
import { NodeSocketTransport } from "@scorel/client/node";
import {
  EmbeddedDaemon,
  createEmbeddedTransport,
  createRealRuntime,
  daemonPackageName,
  loadScorelConfig,
  readLocalDaemonState,
  scorelSessionsDir,
  type ScorelConfig,
} from "@scorel/daemon";
import {
  asClientId,
  asDeviceId,
  asSeq,
  asSessionId,
  type ContentBlock,
  type DeviceId,
  type ErrorEvent,
  type PersistentEvent,
  type ScorelEvent,
} from "@scorel/protocol";

export const cliAppName = "@scorel/app-cli" as const;
export const cliClientDependency = clientPackageName;
export const cliDaemonDependency = daemonPackageName;

export type CliIo = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
};

export type CliRunOptions = {
  config?: ScorelConfig;
  sessionsDir?: string;
};

type ChatOptions = {
  sessionsDir: string;
  stateDir: string;
  sessionId: ReturnType<typeof asSessionId>;
  cwd: string;
  config?: ScorelConfig;
};

const defaultSessionsDir = (): string => scorelSessionsDir(homedir());

const defaultStateDir = (): string => join(homedir(), ".scorel");

export const runCli = async (
  argv: string[],
  io: CliIo = { input: process.stdin, output: process.stdout, error: process.stderr },
  runOptions: CliRunOptions = {},
): Promise<number> => {
  const [command, ...rest] = argv;
  if (command === "chat") {
    if (rest.includes("--help") || rest.includes("-h")) {
      writeUsage(io.output);
      return 0;
    }
    const chatOptions = parseChatOptions(rest);
    const sessionsDir = runOptions.sessionsDir ?? chatOptions.sessionsDir;
    return runChat({ ...chatOptions, config: runOptions.config, sessionsDir, stateDir: stateDirFromSessionsDir(sessionsDir) }, io);
  }
  if (command === "daemon") {
    return runCliDaemon(rest, { stateDir: stateDirFromSessionsDir(runOptions.sessionsDir), output: io.output, error: io.error });
  }
  if (command === "attach") {
    try {
      return runAttach(parseAttachOptions(rest), {
        stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
        cwd: process.cwd(),
        input: io.input,
        output: io.output,
        error: io.error,
      });
    } catch (cause) {
      io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 1;
    }
  }
  if (command === "logs") {
    try {
      return runLogs(parseLogsOptions(rest), {
        sessionsDir: runOptions.sessionsDir ?? defaultSessionsDir(),
        stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
        output: io.output,
        error: io.error,
      });
    } catch (cause) {
      io.error.write(`scorel logs error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 1;
    }
  }
  writeUsage(io.error);
  return command === "--help" || command === "-h" ? 0 : 1;
};

type LogsOptions = {
  sessionId: ReturnType<typeof asSessionId>;
  tail?: number;
  attach: boolean;
  remoteUrl?: string;
};

const runLogs = async (
  options: LogsOptions,
  io: { sessionsDir: string; stateDir: string; output: NodeJS.WritableStream; error: NodeJS.WritableStream },
): Promise<number> => {
  const filePath = options.attach
    ? await findAttachDiagnosticsFilePath(io.stateDir, options.sessionId, options.remoteUrl)
    : join(io.sessionsDir, `${options.sessionId}.log`);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (cause) {
    io.error.write(`scorel logs error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const selected = options.tail === undefined ? lines : lines.slice(-options.tail);
  if (selected.length > 0) {
    io.output.write(`${selected.join("\n")}\n`);
  }
  return 0;
};

type AttachOptions = {
  sessionId: ReturnType<typeof asSessionId>;
  remoteUrl?: string;
  token?: string;
};

const runAttach = async (
  options: AttachOptions,
  io: { stateDir: string; cwd: string; input: NodeJS.ReadableStream; output: NodeJS.WritableStream; error: NodeJS.WritableStream },
): Promise<number> => {
  const state = await readLocalDaemonState({ stateDir: io.stateDir });
  if (!state && !options.remoteUrl) {
    io.error.write("scorel attach error: local daemon is not running\n");
    return 1;
  }
  if (options.remoteUrl && !options.token) {
    io.error.write("scorel attach error: --token is required with --remote\n");
    return 1;
  }
  const transport = options.remoteUrl
    ? new WsTransport({ url: options.remoteUrl, token: options.token ?? "" })
    : new NodeSocketTransport({ path: state!.socketPath, token: state!.token });
  const client = new DaemonClient(transport, {
    clientId: asClientId("client_cli_attach"),
  });
  const diagnostics = new AttachDiagnostics(io.stateDir, options.sessionId);
  try {
    diagnostics.record("attach_connect_started", {
      remote: Boolean(options.remoteUrl),
      remoteUrl: options.remoteUrl,
    });
    await client.connect(options.sessionId);
    const renderer = new AttachEventRenderer(io.output, io.error);
    const cacheScope = attachCacheScope(options, state?.socketPath, client.connectionIdentity);
    diagnostics.setScope(cacheScope);
    diagnostics.record("attach_connect_succeeded", {
      scopeKind: cacheScope.kind,
      scopeLocator: cacheScope.locator,
      deviceId: client.connectionIdentity?.deviceId,
      deviceDisplayName: client.connectionIdentity?.deviceDisplayName,
      projectSlug: client.connectionIdentity?.projectSlug,
    });
    diagnostics.record("attach_cache_scope_resolved", {
      scopeKind: cacheScope.kind,
      scopeLocator: cacheScope.locator,
      displayName: cacheScope.displayName,
    });
    const cacheSnapshot = await readAttachCache(io.stateDir, cacheScope, options.sessionId);
    diagnostics.record("attach_cache_read", {
      persistentEvents: cacheSnapshot.events.length,
      transients: cacheSnapshot.transients.length,
    });
    const persistCache = async (): Promise<void> => {
      await writeAttachCache(io.stateDir, cacheScope, options.sessionId, cacheSnapshot);
      await upsertProjectIndex(
        io.stateDir,
        await projectIndexEntryForAttach(io.stateDir, cacheScope, options, io.cwd, client.connectionIdentity),
      );
      diagnostics.record("attach_cache_written", {
        persistentEvents: cacheSnapshot.events.length,
        transients: cacheSnapshot.transients.length,
      });
    };
    const unsubscribe = client.subscribe((event) => {
      renderer.renderLive(event);
      updateAttachCacheSnapshot(cacheSnapshot, event);
      diagnostics.record("attach_event_rendered", {
        type: event.type,
        seq: "seq" in event ? event.seq : undefined,
      });
      void persistCache();
    });
    const resumed = await loadOrCreateAttachedSession(client, options.sessionId);
    diagnostics.record(resumed ? "attach_session_loaded" : "attach_session_created");
    renderer.writeLine(`scorel attach ${resumed ? "resumed" : "created"} session ${options.sessionId}`);
    renderer.renderBacklog(cacheSnapshot.events);
    renderer.renderTransientBacklog(cacheSnapshot.transients);
    const persistentLastSeq = highestSeq(cacheSnapshot.events);
    const resync = await client.resync({
      persistentLastSeq,
      streamLastSeq: highestCachedStreamSeq(cacheSnapshot),
    });
    diagnostics.record("attach_resync_finished", {
      mode: resync.mode,
      throughSeq: resync.throughSeq,
      persistentLastSeq,
      streamLastSeq: highestCachedStreamSeq(cacheSnapshot),
      receivedEvents: client.getEvents().length,
    });
    if (resync.mode === "full_reload" && cacheSnapshot.events.length > 0) {
      renderer.writeLine("scorel attach authoritative reload follows cached history");
    }
    renderer.renderBacklog(client.getEvents());
    cacheSnapshot.events = mergePersistentEvents([...cacheSnapshot.events, ...client.getEvents()]);
    cacheSnapshot.transients = removeCompletedTransients(cacheSnapshot.transients, cacheSnapshot.events);
    await persistCache();
    renderer.promptIfInteractive();
    const rl = createInterface({ input: io.input as Readable, crlfDelay: Infinity });
    const inputQueue = new AsyncInputQueue();
    const inputWorker = (async () => {
      for (;;) {
        const line = await inputQueue.next();
        if (line === null) {
          return;
        }
        if (line === ".exit" || line === ".quit") {
          return;
        }
        diagnostics.record("attach_send_message_started", { contentLength: line.length });
        try {
          await client.sendMessage(line);
          diagnostics.record("attach_send_message_finished", { contentLength: line.length });
        } catch (cause) {
          diagnostics.record("attach_send_message_error", {
            message: cause instanceof Error ? cause.message : String(cause),
          });
          throw cause;
        }
        renderer.endLine();
        renderer.promptIfInteractive();
      }
    })();
    try {
      for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line.length === 0) {
          continue;
        }
        inputQueue.push(line);
        if (line === ".exit" || line === ".quit") {
          break;
        }
      }
      inputQueue.close();
      await inputWorker;
    } finally {
      inputQueue.close();
      unsubscribe();
      rl.close();
      await persistCache();
    }
    diagnostics.record("attach_disconnected");
    await diagnostics.flush();
    client.disconnect();
    return 0;
  } catch (cause) {
    diagnostics.ensureScope(attachCacheScope(options, state?.socketPath));
    diagnostics.record("attach_failed", { message: cause instanceof Error ? cause.message : String(cause) });
    await diagnostics.flush();
    io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
};

type AttachCacheScope = {
  kind: "local" | "remote";
  locator: string;
  displayName?: string;
};

type AttachCacheFile = {
  version: 1;
  scope: AttachCacheScope;
  sessionId: string;
  events: PersistentEvent[];
  transients?: CachedTransientMessage[];
};

type CachedTransientMessage = {
  eventId: string;
  seq: number;
  text: string;
};

type AttachCacheSnapshot = {
  events: PersistentEvent[];
  transients: CachedTransientMessage[];
};

const attachCacheScope = (
  options: AttachOptions,
  localSocketPath: string | undefined,
  identity?: { deviceId?: DeviceId; deviceDisplayName?: string; projectSlug?: string },
): AttachCacheScope => {
  if (options.remoteUrl) {
    if (identity?.deviceId && identity.projectSlug) {
      return {
        kind: "remote",
        locator: `device:${identity.deviceId}/project:${identity.projectSlug}`,
        displayName: identity.deviceDisplayName,
      };
    }
    return { kind: "remote", locator: `endpoint:${options.remoteUrl}` };
  }
  return { kind: "local", locator: localSocketPath ?? "local-daemon" };
};

const attachCacheFilePath = (stateDir: string, scope: AttachCacheScope, sessionId: ReturnType<typeof asSessionId>): string => {
  const scopeKey = createHash("sha256").update(`${scope.kind}\0${scope.locator}`).digest("hex").slice(0, 24);
  return join(stateDir, "attach-cache", scopeKey, `${sessionId}.json`);
};

const attachDiagnosticsFilePath = (
  stateDir: string,
  scope: AttachCacheScope,
  sessionId: ReturnType<typeof asSessionId>,
): string => {
  const scopeKey = createHash("sha256").update(`${scope.kind}\0${scope.locator}`).digest("hex").slice(0, 24);
  return join(stateDir, "attach-cache", scopeKey, `${sessionId}.log`);
};

const findAttachDiagnosticsFilePath = async (
  stateDir: string,
  sessionId: ReturnType<typeof asSessionId>,
  remoteUrl?: string,
): Promise<string> => {
  const indexed = await findAttachDiagnosticsFilePathFromIndex(stateDir, sessionId, remoteUrl);
  if (indexed) {
    return indexed;
  }
  const root = join(stateDir, "attach-cache");
  const scopes = await readdir(root);
  for (const scope of scopes) {
    const candidate = join(root, scope, `${sessionId}.log`);
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      continue;
    }
  }
  return join(root, "__missing__", `${sessionId}.log`);
};

type ProjectIndexFile = {
  version: 1;
  projects: ProjectIndexEntry[];
};

type ProjectIndexEntry = LocalProjectIndexEntry | RemoteProjectIndexEntry;

type LocalProjectIndexEntry = {
  projectKey: string;
  kind: "local";
  workDir: string;
  displayName: string;
  lastSeenAt: number;
  sessions: Record<string, ProjectIndexSession>;
};

type RemoteProjectIndexEntry = {
  projectKey: string;
  kind: "remote";
  deviceId: string;
  deviceDisplayName?: string;
  projectSlug: string;
  displayName: string;
  lastRemoteUrl?: string;
  lastSeenAt: number;
  sessions: Record<string, ProjectIndexSession>;
};

type ProjectIndexSession = {
  sessionId: string;
  source: "local-session" | "attach-cache";
  sessionPath?: string;
  cachePath?: string;
  logPath?: string;
  lastSeenAt: number;
};

const stateDirFromSessionsDir = (sessionsDir: string | undefined): string => {
  if (!sessionsDir) {
    return defaultStateDir();
  }
  return basename(sessionsDir) === "sessions" ? dirname(sessionsDir) : sessionsDir;
};

const projectIndexFilePath = (stateDir: string): string => join(stateDir, "project-index.json");

const emptyProjectIndex = (): ProjectIndexFile => ({ version: 1, projects: [] });

const readProjectIndex = async (stateDir: string): Promise<ProjectIndexFile> => {
  try {
    const raw = JSON.parse(await readFile(projectIndexFilePath(stateDir), "utf8")) as ProjectIndexFile;
    if (raw.version !== 1 || !Array.isArray(raw.projects)) {
      return emptyProjectIndex();
    }
    return {
      version: 1,
      projects: raw.projects.filter(isProjectIndexEntry),
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return emptyProjectIndex();
    }
    return emptyProjectIndex();
  }
};

const writeProjectIndex = async (stateDir: string, index: ProjectIndexFile): Promise<void> => {
  const filePath = projectIndexFilePath(stateDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`);
};

const upsertProjectIndex = async (stateDir: string, entry: ProjectIndexEntry): Promise<void> => {
  const index = await readProjectIndex(stateDir);
  const existingIndex = index.projects.findIndex((project) => project.projectKey === entry.projectKey);
  if (existingIndex >= 0) {
    const existing = index.projects[existingIndex];
    index.projects[existingIndex] = {
      ...existing,
      ...entry,
      sessions: {
        ...existing.sessions,
        ...entry.sessions,
      },
      lastSeenAt: Math.max(existing.lastSeenAt, entry.lastSeenAt),
    } as ProjectIndexEntry;
  } else {
    index.projects.push(entry);
  }
  index.projects.sort((left, right) => left.projectKey.localeCompare(right.projectKey));
  await writeProjectIndex(stateDir, index);
};

const projectIndexEntryForLocalSession = async (
  stateDir: string,
  sessionsDir: string,
  cwd: string,
  sessionId: ReturnType<typeof asSessionId>,
): Promise<ProjectIndexEntry> => {
  const workDir = await realpathOrResolve(cwd);
  const now = Date.now();
  return {
    projectKey: `local:${workDir}`,
    kind: "local",
    workDir,
    displayName: basename(workDir),
    lastSeenAt: now,
    sessions: {
      [String(sessionId)]: {
        sessionId: String(sessionId),
        source: "local-session",
        sessionPath: relativeProjectPath(stateDir, join(sessionsDir, `${sessionId}.jsonl`)),
        logPath: relativeProjectPath(stateDir, join(sessionsDir, `${sessionId}.log`)),
        lastSeenAt: now,
      },
    },
  };
};

const projectIndexEntryForAttach = async (
  stateDir: string,
  scope: AttachCacheScope,
  options: AttachOptions,
  cwd: string,
  identity?: { deviceId?: DeviceId; deviceDisplayName?: string; projectSlug?: string },
): Promise<ProjectIndexEntry> => {
  const now = Date.now();
  const sessionId = String(options.sessionId);
  if (scope.kind === "remote" && identity?.deviceId && identity.projectSlug) {
    return {
      projectKey: `remote:${identity.deviceId}:${identity.projectSlug}`,
      kind: "remote",
      deviceId: String(identity.deviceId),
      deviceDisplayName: identity.deviceDisplayName,
      projectSlug: identity.projectSlug,
      displayName: identity.projectSlug,
      lastRemoteUrl: options.remoteUrl,
      lastSeenAt: now,
      sessions: {
        [sessionId]: {
          sessionId,
          source: "attach-cache",
          cachePath: relativeProjectPath(stateDir, attachCacheFilePath(stateDir, scope, options.sessionId)),
          logPath: relativeProjectPath(stateDir, attachDiagnosticsFilePath(stateDir, scope, options.sessionId)),
          lastSeenAt: now,
        },
      },
    };
  }
  const workDir = await realpathOrResolve(cwd);
  return {
    projectKey: `local:${workDir}`,
    kind: "local",
    workDir,
    displayName: basename(workDir),
    lastSeenAt: now,
    sessions: {
      [sessionId]: {
        sessionId,
        source: "attach-cache",
        cachePath: relativeProjectPath(stateDir, attachCacheFilePath(stateDir, scope, options.sessionId)),
        logPath: relativeProjectPath(stateDir, attachDiagnosticsFilePath(stateDir, scope, options.sessionId)),
        lastSeenAt: now,
      },
    },
  };
};

const findAttachDiagnosticsFilePathFromIndex = async (
  stateDir: string,
  sessionId: ReturnType<typeof asSessionId>,
  remoteUrl: string | undefined,
): Promise<string | undefined> => {
  const index = await readProjectIndex(stateDir);
  const matches = index.projects
    .filter((project) => (remoteUrl ? project.kind === "remote" && project.lastRemoteUrl === remoteUrl : true))
    .map((project) => project.sessions[String(sessionId)])
    .filter((session): session is ProjectIndexSession => session?.source === "attach-cache" && typeof session.logPath === "string");
  if (matches.length !== 1) {
    return undefined;
  }
  return join(stateDir, matches[0].logPath!);
};

const isProjectIndexEntry = (value: unknown): value is ProjectIndexEntry => {
  if (typeof value !== "object" || value === null || !("projectKey" in value) || !("kind" in value) || !("sessions" in value)) {
    return false;
  }
  const candidate = value as { projectKey?: unknown; kind?: unknown; sessions?: unknown; lastSeenAt?: unknown };
  return (
    typeof candidate.projectKey === "string" &&
    (candidate.kind === "local" || candidate.kind === "remote") &&
    typeof candidate.sessions === "object" &&
    candidate.sessions !== null &&
    typeof candidate.lastSeenAt === "number"
  );
};

const relativeProjectPath = (stateDir: string, filePath: string): string => relative(stateDir, filePath).split("\\").join("/");

const realpathOrResolve = async (filePath: string): Promise<string> => {
  try {
    return await realpath(filePath);
  } catch {
    return resolve(filePath);
  }
};

class AttachDiagnostics {
  readonly #stateDir: string;
  readonly #sessionId: ReturnType<typeof asSessionId>;
  readonly #pendingLines: string[] = [];
  readonly #writes: Array<Promise<void>> = [];
  #scope: AttachCacheScope | undefined;

  constructor(stateDir: string, sessionId: ReturnType<typeof asSessionId>) {
    this.#stateDir = stateDir;
    this.#sessionId = sessionId;
  }

  setScope(scope: AttachCacheScope): void {
    this.#scope = scope;
    for (const line of this.#pendingLines.splice(0)) {
      this.#append(line);
    }
  }

  ensureScope(scope: AttachCacheScope): void {
    if (!this.#scope) {
      this.setScope(scope);
    }
  }

  record(event: string, fields: Record<string, unknown> = {}): void {
    const line = formatDiagnosticLine({
      ts: Date.now(),
      level: event.endsWith("_error") || event.endsWith("_failed") ? "error" : "info",
      event,
      sessionId: this.#sessionId,
      ...redactDiagnosticFields(fields),
    });
    if (!this.#scope) {
      this.#pendingLines.push(line);
      return;
    }
    this.#append(line);
  }

  async flush(): Promise<void> {
    if (this.#scope) {
      for (const line of this.#pendingLines.splice(0)) {
        this.#append(line);
      }
    }
    await Promise.allSettled(this.#writes);
  }

  #append(line: string): void {
    if (!this.#scope) {
      this.#pendingLines.push(line);
      return;
    }
    const filePath = attachDiagnosticsFilePath(this.#stateDir, this.#scope, this.#sessionId);
    this.#writes.push(
      mkdir(dirname(filePath), { recursive: true }).then(() => appendFile(filePath, `${line}\n`, "utf8")),
    );
  }
}

const readAttachCache = async (
  stateDir: string,
  scope: AttachCacheScope,
  sessionId: ReturnType<typeof asSessionId>,
): Promise<AttachCacheSnapshot> => {
  try {
    const raw = JSON.parse(await readFile(attachCacheFilePath(stateDir, scope, sessionId), "utf8")) as AttachCacheFile;
    if (
      raw.version !== 1 ||
      raw.sessionId !== String(sessionId) ||
      raw.scope.kind !== scope.kind ||
      raw.scope.locator !== scope.locator ||
      !Array.isArray(raw.events)
    ) {
      return emptyAttachCacheSnapshot();
    }
    const events = mergePersistentEvents(raw.events);
    return {
      events,
      transients: removeCompletedTransients(
        Array.isArray(raw.transients) ? raw.transients.filter(isCachedTransientMessage) : [],
        events,
      ),
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return emptyAttachCacheSnapshot();
    }
    return emptyAttachCacheSnapshot();
  }
};

const writeAttachCache = async (
  stateDir: string,
  scope: AttachCacheScope,
  sessionId: ReturnType<typeof asSessionId>,
  snapshot: AttachCacheSnapshot,
): Promise<void> => {
  const filePath = attachCacheFilePath(stateDir, scope, sessionId);
  const uniqueEvents = mergePersistentEvents(snapshot.events);
  const transients = removeCompletedTransients(snapshot.transients, uniqueEvents);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({ version: 1, scope, sessionId: String(sessionId), events: uniqueEvents, transients } satisfies AttachCacheFile, null, 2)}\n`,
  );
};

const emptyAttachCacheSnapshot = (): AttachCacheSnapshot => ({ events: [], transients: [] });

const mergePersistentEvents = (events: PersistentEvent[]): PersistentEvent[] => {
  const byId = new Map<string, PersistentEvent>();
  for (const event of events) {
    byId.set(String(event.id), event);
  }
  return [...byId.values()].sort((left, right) => Number(left.seq) - Number(right.seq));
};

const highestSeq = (events: PersistentEvent[]): ReturnType<typeof asSeq> =>
  asSeq(events.reduce((max, event) => Math.max(max, Number(event.seq)), 0));

const highestCachedStreamSeq = (snapshot: AttachCacheSnapshot): ReturnType<typeof asSeq> =>
  asSeq(Math.max(Number(highestSeq(snapshot.events)), ...snapshot.transients.map((event) => event.seq), 0));

const updateAttachCacheSnapshot = (snapshot: AttachCacheSnapshot, event: ScorelEvent): void => {
  if ("id" in event) {
    snapshot.events = mergePersistentEvents([...snapshot.events, event]);
    snapshot.transients = removeCompletedTransients(snapshot.transients, snapshot.events);
    return;
  }
  if (event.type !== "text_delta") {
    return;
  }
  const existing = snapshot.transients.find((candidate) => candidate.eventId === String(event.eventId));
  if (existing) {
    existing.seq = Math.max(existing.seq, Number(event.seq));
    existing.text += event.delta;
  } else {
    snapshot.transients.push({
      eventId: String(event.eventId),
      seq: Number(event.seq),
      text: event.delta,
    });
  }
};

const removeCompletedTransients = (
  transients: CachedTransientMessage[],
  events: PersistentEvent[],
): CachedTransientMessage[] => {
  const persistentIds = new Set(events.map((event) => String(event.id)));
  return transients.filter((transient) => !persistentIds.has(transient.eventId) && transient.text.length > 0);
};

const isCachedTransientMessage = (value: unknown): value is CachedTransientMessage =>
  typeof value === "object" &&
  value !== null &&
  "eventId" in value &&
  "seq" in value &&
  "text" in value &&
  typeof value.eventId === "string" &&
  typeof value.seq === "number" &&
  typeof value.text === "string";

class AsyncInputQueue {
  readonly #items: string[] = [];
  #closed = false;
  #notify: (() => void) | undefined;

  push(line: string): void {
    if (this.#closed) {
      return;
    }
    this.#items.push(line);
    this.#notify?.();
    this.#notify = undefined;
  }

  close(): void {
    this.#closed = true;
    this.#notify?.();
    this.#notify = undefined;
  }

  async next(): Promise<string | null> {
    while (this.#items.length === 0 && !this.#closed) {
      await new Promise<void>((resolve) => {
        this.#notify = resolve;
      });
    }
    return this.#items.shift() ?? null;
  }
}

const loadOrCreateAttachedSession = async (client: DaemonClient, sessionId: ReturnType<typeof asSessionId>): Promise<boolean> => {
  try {
    await client.loadSession(sessionId);
    return true;
  } catch {
    await client.createSession({
      sessionId,
      meta: {},
    });
    return false;
  }
};

const parseAttachOptions = (argv: string[]): AttachOptions => {
  let sessionId = asSessionId("ses_default");
  let remoteUrl: string | undefined;
  let token: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--session") {
      sessionId = asSessionId(requireValue(argv, index, "--session"));
      index += 1;
      continue;
    }
    if (arg === "--remote") {
      remoteUrl = requireValue(argv, index, "--remote");
      index += 1;
      continue;
    }
    if (arg === "--token") {
      token = requireValue(argv, index, "--token");
      index += 1;
      continue;
    }
    throw new Error(`Unknown attach option: ${arg}`);
  }
  return { sessionId, remoteUrl, token };
};

const parseLogsOptions = (argv: string[]): LogsOptions => {
  let sessionId: ReturnType<typeof asSessionId> | undefined;
  let tail: number | undefined;
  let attach = false;
  let remoteUrl: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--attach") {
      attach = true;
      continue;
    }
    if (arg === "--remote") {
      remoteUrl = requireValue(argv, index, "--remote");
      index += 1;
      continue;
    }
    if (arg === "--session") {
      sessionId = asSessionId(requireValue(argv, index, "--session"));
      index += 1;
      continue;
    }
    if (arg === "--tail") {
      tail = Number(requireValue(argv, index, "--tail"));
      if (!Number.isInteger(tail) || tail < 0) {
        throw new Error("--tail must be a non-negative integer");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown logs option: ${arg}`);
  }
  if (!sessionId) {
    throw new Error("--session requires a value");
  }
  return { sessionId, tail, attach, remoteUrl };
};

const runCliDaemon = async (
  argv: string[],
  options: { stateDir: string; output: NodeJS.WritableStream; error: NodeJS.WritableStream },
): Promise<number> => {
  const [command] = argv;
  if (command === "status") {
    const state = await readLocalDaemonState({ stateDir: options.stateDir });
    if (!state) {
      options.error.write("scorel daemon stopped\n");
      return 1;
    }
    options.output.write(`scorel daemon running pid=${state.pid} socket=${state.socketPath}\n`);
    return 0;
  }
  options.error.write("Usage: scorel daemon status\n");
  return command === "--help" || command === "-h" ? 0 : 1;
};

export const runChat = async (options: ChatOptions, io: CliIo): Promise<number> => {
  const config = options.config ?? (await loadScorelConfig({ cwd: options.cwd }));
  const daemon = new EmbeddedDaemon({
    sessionsDir: options.sessionsDir,
    deviceId: asDeviceId("device_local"),
    createRuntime: () => createRealRuntime({ cwd: options.cwd, config }),
  });
  const client = new DaemonClient(createEmbeddedTransport(daemon), {
    clientId: asClientId("client_cli"),
  });

  await daemon.start();
  try {
    await client.connect(options.sessionId);
    const resumed = await loadOrCreateSession(client, options, config);
    await upsertProjectIndex(
      options.stateDir,
      await projectIndexEntryForLocalSession(options.stateDir, options.sessionsDir, options.cwd, options.sessionId),
    );
    io.error.write(`scorel chat ${resumed ? "resumed" : "created"} session ${options.sessionId}\n`);

    const rl = createInterface({ input: io.input as Readable, crlfDelay: Infinity });
    promptIfInteractive(io.output);
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (line.length === 0) {
        promptIfInteractive(io.output);
        continue;
      }
      if (line === ".exit" || line === ".quit") {
        break;
      }

      const unsubscribe = client.subscribe((event) => {
        if (event.type === "text_delta") {
          io.output.write(event.delta);
        }
        if (event.type === "tool_result") {
          writeToolResult(io.output, event);
        }
        if (event.type === "error") {
          writeEventError(io.error, event);
        }
      });
      try {
        await client.sendMessage(line);
        io.output.write("\n");
      } finally {
        unsubscribe();
      }
      promptIfInteractive(io.output);
    }
    rl.close();
    return 0;
  } catch (cause) {
    io.error.write(`scorel chat error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  } finally {
    client.disconnect();
    await daemon.shutdown();
  }
};

const loadOrCreateSession = async (client: DaemonClient, options: ChatOptions, config: ScorelConfig): Promise<boolean> => {
  try {
    await client.loadSession(options.sessionId);
    return true;
  } catch {
    await client.createSession({
      sessionId: options.sessionId,
      meta: { model: config.model.id },
    });
    return false;
  }
};

const parseChatOptions = (argv: string[]): ChatOptions => {
  let sessionId = asSessionId("ses_default");
  let cwd = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--session") {
      sessionId = asSessionId(requireValue(argv, index, "--session"));
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      cwd = requireValue(argv, index, "--cwd");
      index += 1;
      continue;
    }
    throw new Error(`Unknown chat option: ${arg}`);
  }

  const sessionsDir = defaultSessionsDir();
  return { sessionId, sessionsDir, stateDir: stateDirFromSessionsDir(sessionsDir), cwd };
};

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const promptIfInteractive = (output: NodeJS.WritableStream): void => {
  if ((output as Writable & { isTTY?: boolean }).isTTY) {
    output.write("> ");
  }
};

const writeUsage = (output: NodeJS.WritableStream): void => {
  output.write("Usage: scorel chat [--session <id>] [--cwd <dir>]\nUsage: scorel attach [--session <id>] [--remote <ws-url> --token <token>]\nUsage: scorel logs [--attach] --session <id> [--remote <ws-url>] [--tail <n>]\n");
};

const writeEventError = (output: NodeJS.WritableStream, event: ErrorEvent): void => {
  output.write(`scorel event error: ${event.message}\n`);
};

const writeToolResult = (output: NodeJS.WritableStream, event: Extract<ScorelEvent, { type: "tool_result" }>): void => {
  const block = event.message.content.find((candidate) => candidate.type === "tool_result");
  if (!block || typeof block.result !== "object" || block.result === null) {
    return;
  }
  const result = block.result as { content?: Array<{ type: string; text?: string }> };
  const text = result.content?.find((candidate) => candidate.type === "text")?.text ?? "";
  output.write(`\n[tool:${block.toolName}]${block.isError ? " error" : ""}\n${text}\n`);
};

const redactDiagnosticFields = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      /token|secret|api[-_]?key|authorization/i.test(key) ? "[redacted]" : value,
    ]),
  );

const formatDiagnosticLine = (fields: Record<string, unknown>): string =>
  Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`)
    .join(" ");

const formatDiagnosticValue = (value: unknown): string => {
  const text = typeof value === "string" ? value : String(value);
  return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
};

class AttachEventRenderer {
  readonly #output: NodeJS.WritableStream;
  readonly #error: NodeJS.WritableStream;
  readonly #printedPersistentIds = new Set<string>();
  readonly #streamedMessageIds = new Set<string>();
  #atLineStart = true;

  constructor(output: NodeJS.WritableStream, error: NodeJS.WritableStream) {
    this.#output = output;
    this.#error = error;
  }

  renderBacklog(events: PersistentEvent[]): void {
    for (const event of events) {
      this.#render(event);
    }
  }

  renderTransientBacklog(transients: CachedTransientMessage[]): void {
    for (const transient of transients) {
      this.#streamedMessageIds.add(transient.eventId);
      this.#write(transient.text);
    }
  }

  renderLive(event: ScorelEvent): void {
    this.#render(event);
  }

  endLine(): void {
    if (!this.#atLineStart) {
      this.#write("\n");
    }
  }

  writeLine(text: string): void {
    this.#ensureLineStart();
    this.#write(`${text}\n`);
  }

  promptIfInteractive(): void {
    if ((this.#output as Writable & { isTTY?: boolean }).isTTY) {
      this.#write("> ");
    }
  }

  #render(event: ScorelEvent): void {
    if (event.type === "text_delta") {
      this.#streamedMessageIds.add(String(event.eventId));
      this.#write(event.delta);
      return;
    }
    if (event.type === "error") {
      this.endLine();
      writeEventError(this.#error, event);
      return;
    }
    if (!("id" in event) || this.#printedPersistentIds.has(String(event.id))) {
      return;
    }
    this.#printedPersistentIds.add(String(event.id));

    if (event.type === "user_message") {
      this.#ensureLineStart();
      this.#write(`[user] ${blocksToText(event.message.content)}\n`);
      return;
    }
    if (event.type === "assistant_message") {
      if (this.#streamedMessageIds.has(String(event.id))) {
        this.endLine();
        return;
      }
      const text = blocksToText(event.message.content);
      if (text.length > 0) {
        this.#ensureLineStart();
        this.#write(`${text}\n`);
      }
      return;
    }
    if (event.type === "tool_result") {
      this.#ensureLineStart();
      writeToolResult(this.#output, event);
      this.#atLineStart = true;
    }
  }

  #ensureLineStart(): void {
    if (!this.#atLineStart) {
      this.#write("\n");
    }
  }

  #write(text: string): void {
    this.#output.write(text);
    this.#atLineStart = text.endsWith("\n");
  }
}

const blocksToText = (blocks: ContentBlock[]): string =>
  blocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
