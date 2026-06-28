#!/usr/bin/env -S node --import tsx
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, realpath, readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { basename, dirname, join } from "node:path";

import { DaemonClient, WsTransport, clientPackageName } from "@scorel/client";
import {
  buildRunObservation,
  buildLangfuseSyncPayload,
  buildObservationAsset,
  buildOtelDeltaPayload,
  loadSession,
  readObservabilitySyncState,
  resolveModelSelection,
  resolvePiAiModel,
  sessionArtifactsDirPath,
  sessionObservationSummaryFilePath,
  sessionLogFilePath,
  uploadLangfusePayload,
  uploadOtelPayload,
  writeObservabilitySyncState,
  type RunCostEstimate,
  type RunReportingModel,
} from "@scorel/core";
import {
  ScorelHost,
  createEmbeddedTransport,
  createRealRuntime,
  daemonPackageName,
  loadScorelConfig,
  loadScorelConfigProfile,
  readLocalDaemonState,
  scorelSessionsDir,
  type ScorelConfig,
} from "@scorel/daemon";
import {
  asClientId,
  asDeviceId,
  asProjectId,
  asSeq,
  asSessionId,
  type ContentBlock,
  type DeviceId,
  type ErrorEvent,
  type ModelRole,
  type ModelSelectionInput,
  type PersistentEvent,
  type ProjectId,
  type ScorelEvent,
  type SessionId,
} from "@scorel/protocol";

import { runCliDaemon } from "./daemon-cli.js";
import { runCliPair } from "./relay-cli.js";
import { runCliRelay } from "./relay-server-cli.js";
import { runCliUp } from "./up-cli.js";
import { runCliWebUi } from "./webui-cli.js";
import { readInstalledScorelVersion, runCliUpdate } from "./update-cli.js";

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
  sessionId: SessionId;
  cwd: string;
  config?: ScorelConfig;
};

type RunOutputFormat = "text" | "json" | "stream-json" | "none";
type RunProviderApi = "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";

type RunProviderOverride = {
  provider?: string;
  api?: RunProviderApi;
  baseUrl?: string;
  apiKey?: string;
};

type RunOptions = {
  promptSource: "argument" | "prompt" | "prompt-file" | "stdin";
  prompt?: string;
  promptFile?: string;
  sessionsDir: string;
  stateDir: string;
  sessionId: SessionId;
  cwd: string;
  timeoutMs?: number;
  outputFormat: RunOutputFormat;
  summaryPath?: string;
  reportDir?: string;
  quiet: boolean;
  modelSelection?: ModelSelectionInput;
  providerOverride?: RunProviderOverride;
  config?: ScorelConfig;
};

type ObserveSyncTarget = "langfuse" | "otel";

type ObserveSyncOptions = {
  command: "sync";
  sessionId: SessionId;
  target: ObserveSyncTarget;
  sessionsDir: string;
  stateDir: string;
  outPath?: string;
  config?: ScorelConfig;
};

type RunSummary = {
  status: "completed" | "error" | "timeout";
  sessionId: string;
  projectId?: string;
  cwd: string;
  stateDir: string;
  sessionsDir: string;
  sessionJsonl: string;
  outputFormat: RunOutputFormat;
  elapsedMs: number;
  exitReason: "completed" | "error" | "timeout";
  assistantEventId?: string;
  userEventId?: string;
  error?: { message: string };
  events?: ScorelEvent[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model?: RunReportingModel;
  cost: RunCostEstimate;
  reports: Record<string, string>;
};

const defaultSessionsDir = (): string => scorelSessionsDir(homedir());

const defaultStateDir = (): string => join(homedir(), ".scorel");

export const runCli = async (
  argv: string[],
  io: CliIo = { input: process.stdin, output: process.stdout, error: process.stderr },
  runOptions: CliRunOptions = {},
): Promise<number> => {
  const [command, ...rest] = argv;
  if (command === "--version" || command === "-v" || command === "version") {
    io.output.write(`${await readInstalledScorelVersion()}\n`);
    return 0;
  }
  if (!command || command === "chat") {
    if (rest.includes("--help") || rest.includes("-h")) {
      writeUsage(io.output);
      return 0;
    }
    const chatOptions = parseChatOptions(rest);
    const sessionsDir = runOptions.sessionsDir ?? chatOptions.sessionsDir;
    return runChat({ ...chatOptions, config: runOptions.config, sessionsDir, stateDir: stateDirFromSessionsDir(sessionsDir) }, io);
  }
  if (command === "run") {
    if (rest.includes("--help") || rest.includes("-h")) {
      writeRunUsage(io.output);
      return 0;
    }
    try {
      return runHeadless(parseRunOptions(rest, runOptions), io);
    } catch (cause) {
      io.error.write(`scorel run error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
  }
  if (command === "observe") {
    if (rest.includes("--help") || rest.includes("-h")) {
      writeObserveUsage(io.output);
      return 0;
    }
    try {
      return runObserve(parseObserveOptions(rest, runOptions), io);
    } catch (cause) {
      io.error.write(`scorel observe error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 1;
    }
  }
  if (command === "daemon") {
    return runCliDaemon(rest, {
      stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
      sessionsDir: runOptions.sessionsDir,
      output: io.output,
      error: io.error,
    });
  }
  if (command === "host") {
    return runCliDaemon(rest, {
      stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
      sessionsDir: runOptions.sessionsDir,
      output: io.output,
      error: io.error,
    });
  }
  if (command === "relay") {
    return runCliRelay(rest, { output: io.output, error: io.error });
  }
  if (command === "pair") {
    return runCliPair(rest, {
      stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
      output: io.output,
      error: io.error,
    });
  }
  if (command === "webui") {
    return runCliWebUi(rest, { output: io.output, error: io.error });
  }
  if (command === "up") {
    return runCliUp(rest, {
      stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
      output: io.output,
      error: io.error,
    });
  }
  if (command === "update" || command === "upgrade") {
    return runCliUpdate(rest, { output: io.output, error: io.error });
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
  if (command === "project") {
    return runProject(rest, {
      stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
      output: io.output,
      error: io.error,
    });
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

const runProject = async (
  argv: string[],
  io: { stateDir: string; output: NodeJS.WritableStream; error: NodeJS.WritableStream },
): Promise<number> => {
  const [command, value, ...extra] = argv;
  if (extra.length > 0 || !["list", "add", "remove"].includes(command ?? "")) {
    writeProjectUsage(io.error);
    return 1;
  }
  if ((command === "add" || command === "remove") && !value) {
    writeProjectUsage(io.error);
    return 1;
  }
  if (command === "list" && value) {
    writeProjectUsage(io.error);
    return 1;
  }
  const state = await readLocalDaemonState({ stateDir: io.stateDir });
  if (!state || state.stoppedAt !== null) {
    io.error.write("scorel project error: local daemon is not running\n");
    return 1;
  }
  const client = new DaemonClient(new WsTransport({ url: state.wsUrl, token: state.token }), {
    clientId: asClientId("client_cli_project"),
  });
  try {
    await client.connect();
    if (command === "list") {
      for (const project of await client.listProjects()) {
        io.output.write(`${project.projectId}\t${project.displayName}\t${project.workDir}\n`);
      }
    } else if (command === "add") {
      const project = await client.registerProject(value!);
      io.output.write(`${project.projectId}\t${project.displayName}\t${project.workDir}\n`);
    } else {
      await client.removeProject(asProjectId(value!));
      io.output.write(`removed ${value}\n`);
    }
    return 0;
  } catch (cause) {
    io.error.write(`scorel project error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  } finally {
    client.disconnect();
  }
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
  remoteUrl: string;
  token: string;
};

const runAttach = async (
  options: AttachOptions,
  io: { stateDir: string; cwd: string; input: NodeJS.ReadableStream; output: NodeJS.WritableStream; error: NodeJS.WritableStream },
): Promise<number> => {
  const transport = new WsTransport({ url: options.remoteUrl, token: options.token });
  const client = new DaemonClient(transport, {
    clientId: asClientId("client_cli_attach"),
  });
  const diagnostics = new AttachDiagnostics(io.stateDir, options.sessionId);
  try {
    diagnostics.record("attach_connect_started", {
      remoteUrl: options.remoteUrl,
    });
    await client.connect();
    const loaded = await client.loadSession(options.sessionId);
    const renderer = new AttachEventRenderer(io.output, io.error);
    const cacheScope = attachCacheScope(client.connectionIdentity, loaded.meta.projectId);
    diagnostics.setScope(cacheScope);
    diagnostics.record("attach_connect_succeeded", {
      scopeKind: cacheScope.kind,
      scopeLocator: cacheScope.locator,
      deviceId: client.connectionIdentity?.deviceId,
      deviceDisplayName: client.connectionIdentity?.deviceDisplayName,
      projectId: loaded.meta.projectId,
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
    diagnostics.record("attach_session_loaded");
    renderer.writeLine(`scorel attach resumed session ${options.sessionId}`);
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
    diagnostics.record("attach_failed", { message: cause instanceof Error ? cause.message : String(cause) });
    await diagnostics.flush();
    io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
};

type AttachCacheScope = {
  kind: "remote";
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
  identity: { deviceId?: DeviceId; deviceDisplayName?: string },
  projectId: string,
): AttachCacheScope => {
  if (!identity.deviceId) {
    throw new Error("Remote daemon handshake is missing deviceId");
  }
  return {
    kind: "remote",
    locator: `device:${identity.deviceId}/project:${projectId}`,
    displayName: identity.deviceDisplayName,
  };
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
  _remoteUrl?: string,
): Promise<string> => {
  const root = join(stateDir, "attach-cache");
  const scopes = await readdir(root).catch(() => []);
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

const stateDirFromSessionsDir = (sessionsDir: string | undefined): string => {
  if (!sessionsDir) {
    return defaultStateDir();
  }
  return basename(sessionsDir) === "sessions" ? dirname(sessionsDir) : sessionsDir;
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
  if (!remoteUrl) {
    throw new Error("--remote is required (e.g. --remote ws://127.0.0.1:7777)");
  }
  if (!token) {
    throw new Error("--token is required with --remote");
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

export const runChat = async (options: ChatOptions, io: CliIo): Promise<number> => {
  const configScope = { scorelHomeDir: options.stateDir };
  const loadProjectConfig = async (project: { workDir: string }) =>
    options.config ?? (await loadScorelConfig({ cwd: project.workDir, ...configScope }));
  const loadProjectConfigProfile = async (project: { workDir: string }) =>
    options.config ?? (await loadScorelConfigProfile({ cwd: project.workDir, ...configScope }));
  const daemon = new ScorelHost({
    sessionsDir: options.sessionsDir,
    projectsPath: join(options.stateDir, "projects.json"),
    deviceId: asDeviceId("device_local"),
    scorelHomeDir: options.stateDir,
    loadConfig: async ({ project }) => loadProjectConfig(project),
    loadConfigProfile: async ({ project }) => loadProjectConfigProfile(project),
    createRuntime: async ({ sessionId, project, selectedModel, purpose }) => createRealRuntime({
      cwd: project.workDir,
      config: await loadProjectConfig(project),
      sessionsDir: options.sessionsDir,
      sessionId,
      modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : undefined,
      includeTools: purpose === "chat",
    }),
  });
  const client = new DaemonClient(createEmbeddedTransport(daemon), {
    clientId: asClientId("client_cli"),
  });

  await daemon.start();
  const project = await daemon.registerProject(options.cwd);
  let inFlight = false;
  let rlClose = (): void => undefined;
  const sigintHandler = createSigintHandler({
    isInFlight: () => inFlight,
    cancel: () => client.cancel().then(() => undefined).catch(() => undefined),
    output: io.output,
    exit: () => rlClose(),
  });
  process.on("SIGINT", sigintHandler);
  try {
    await client.connect(options.sessionId);
    const resumed = await loadOrCreateSession(client, options.sessionId, project.projectId);
    io.error.write(`scorel chat ${resumed ? "resumed" : "created"} session ${options.sessionId}\n`);

    const rl = createInterface({ input: io.input as Readable, crlfDelay: Infinity });
    rlClose = () => rl.close();
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
      inFlight = true;
      try {
        await client.sendMessage(line);
        io.output.write("\n");
      } finally {
        inFlight = false;
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
    process.off("SIGINT", sigintHandler);
    client.disconnect();
    await daemon.shutdown();
  }
};

const runHeadless = async (options: RunOptions, io: CliIo): Promise<number> => {
  const startedAt = Date.now();
  let projectId: ProjectId | undefined;
  const textParts: string[] = [];
  const events: ScorelEvent[] = [];
  const prompt = await readRunPrompt(options, io);
  const runConfig = resolveRunConfig(options);
  let reportingModel: RunReportingModel | undefined;
  const configScope = { scorelHomeDir: options.stateDir };
  const loadProjectConfig = async (project: { workDir: string }) =>
    runConfig ?? options.config ?? (await loadScorelConfig({ cwd: project.workDir, ...configScope }));
  const loadProjectConfigProfile = async (project: { workDir: string }) =>
    runConfig ?? options.config ?? (await loadScorelConfigProfile({ cwd: project.workDir, ...configScope }));
  const daemon = new ScorelHost({
    sessionsDir: options.sessionsDir,
    projectsPath: join(options.stateDir, "projects.json"),
    deviceId: asDeviceId("device_local"),
    scorelHomeDir: options.stateDir,
    loadConfig: async ({ project }) => loadProjectConfig(project),
    loadConfigProfile: async ({ project }) => loadProjectConfigProfile(project),
    createRuntime: async ({ sessionId, project, selectedModel, purpose }) => createRealRuntime({
      cwd: project.workDir,
      config: await loadProjectConfig(project),
      sessionsDir: options.sessionsDir,
      sessionId,
      modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : undefined,
      includeTools: purpose === "chat",
    }),
  });
  const client = new DaemonClient(createEmbeddedTransport(daemon), {
    clientId: asClientId("client_cli_run"),
  });
  let unsubscribe: (() => void) | undefined;

  try {
    await daemon.start();
    const project = await daemon.registerProject(options.cwd);
    projectId = project.projectId;
    reportingModel = runReportingModel(await loadProjectConfig(project), options.modelSelection);
    await client.connect(options.sessionId);
    await loadOrCreateSession(client, options.sessionId, project.projectId, options.modelSelection);
    unsubscribe = client.subscribe((event) => {
      events.push(event);
      if (event.type === "text_delta") {
        textParts.push(event.delta);
      }
      renderRunEvent(options, io, event);
    });
    const send = client.sendMessage(prompt, options.modelSelection ? { modelSelection: options.modelSelection } : undefined);
    const result = options.timeoutMs === undefined
      ? await send
      : await withRunTimeout(send, options.timeoutMs, async () => {
        await client.cancel().catch(() => undefined);
      });
    const runtimeError = runErrorFromEvents(events);
    const summary = makeRunSummary({
      options,
      startedAt,
      projectId,
      reportingModel,
      status: runtimeError ? "error" : "completed",
      exitReason: runtimeError ? "error" : "completed",
      userEventId: String(result.userEventId),
      assistantEventId: String(result.assistantEventId),
      ...(runtimeError ? { error: runtimeError } : {}),
      events,
    });
    await writeRunSummary(options.summaryPath, summary);
    await writeRunReports(options.reportDir, summary);
    renderRunFinal(options, io, summary, textParts.join(""));
    return runtimeError ? 1 : 0;
  } catch (cause) {
    const isTimeout = cause instanceof RunTimeoutError;
    const summary = makeRunSummary({
      options,
      startedAt,
      projectId,
      reportingModel,
      status: isTimeout ? "timeout" : "error",
      exitReason: isTimeout ? "timeout" : "error",
      error: cause instanceof Error ? cause : new Error(String(cause)),
      events,
    });
    await writeRunSummary(options.summaryPath, summary).catch(() => undefined);
    await writeRunReports(options.reportDir, summary).catch(() => undefined);
    renderRunFinal(options, io, summary, textParts.join(""));
    if (!options.quiet && options.outputFormat === "text") {
      io.error.write(`scorel run error: ${summary.error?.message ?? "unknown error"}\n`);
    }
    return isTimeout ? 124 : 1;
  } finally {
    unsubscribe?.();
    client.disconnect();
    await daemon.shutdown();
  }
};

const renderRunEvent = (options: RunOptions, io: CliIo, event: ScorelEvent): void => {
  if (options.outputFormat === "none" || options.outputFormat === "json") {
    return;
  }
  if (options.outputFormat === "stream-json") {
    writeJsonLine(io.output, { type: "event", event });
    return;
  }
  if (event.type === "text_delta") {
    io.output.write(event.delta);
  }
  if (event.type === "tool_result") {
    writeToolResult(io.output, event);
  }
  if (event.type === "error") {
    writeEventError(io.error, event);
  }
};

const renderRunFinal = (options: RunOptions, io: CliIo, summary: RunSummary, text: string): void => {
  if (options.outputFormat === "none") {
    return;
  }
  if (options.outputFormat === "json") {
    io.output.write(`${JSON.stringify({ ...summary, result: text })}\n`);
    return;
  }
  if (options.outputFormat === "stream-json") {
    writeJsonLine(io.output, { type: "result", summary, result: text });
    return;
  }
  if (!text.endsWith("\n")) {
    io.output.write("\n");
  }
};

const writeJsonLine = (output: NodeJS.WritableStream, value: unknown): void => {
  output.write(`${JSON.stringify(value)}\n`);
};

class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`run timed out after ${timeoutMs}ms`);
    this.name = "RunTimeoutError";
  }
}

const withRunTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Promise<void>): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          void onTimeout().finally(() => reject(new RunTimeoutError(timeoutMs)));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const makeRunSummary = (input: {
  options: RunOptions;
  startedAt: number;
  projectId?: ProjectId;
  reportingModel?: RunReportingModel;
  status: RunSummary["status"];
  exitReason: RunSummary["exitReason"];
  userEventId?: string;
  assistantEventId?: string;
  error?: Error;
  events?: ScorelEvent[];
}): RunSummary => {
  const events = input.events ?? [];
  const observation = buildRunObservation({ events, selectedModel: input.reportingModel });
  const reports = runReportPaths(input.options);
  return {
    status: input.status,
    sessionId: String(input.options.sessionId),
    ...(input.projectId ? { projectId: String(input.projectId) } : {}),
    cwd: input.options.cwd,
    stateDir: input.options.stateDir,
    sessionsDir: input.options.sessionsDir,
    sessionJsonl: join(input.options.sessionsDir, `${input.options.sessionId}.jsonl`),
    outputFormat: input.options.outputFormat,
    elapsedMs: Date.now() - input.startedAt,
    exitReason: input.exitReason,
    ...(input.userEventId ? { userEventId: input.userEventId } : {}),
    ...(input.assistantEventId ? { assistantEventId: input.assistantEventId } : {}),
    ...(input.error ? { error: { message: input.error.message } } : {}),
    ...(input.events ? { events: input.events } : {}),
    usage: observation.usage,
    ...(observation.model ? { model: observation.model } : {}),
    cost: observation.cost,
    reports,
  };
};

const runErrorFromEvents = (events: ScorelEvent[]): Error | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "error") {
      return new Error((event as ErrorEvent).message);
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "assistant_message" || event.message.stopReason !== "error") {
      continue;
    }
    const failedAssistant = event as Extract<PersistentEvent, { type: "assistant_message" }>;
    const metaMessage = failedAssistant.message.meta?.errorMessage;
    return new Error(typeof metaMessage === "string" && metaMessage.length > 0 ? metaMessage : "assistant stopped with error");
  }
  return undefined;
};

const writeRunSummary = async (path: string | undefined, summary: RunSummary): Promise<void> => {
  if (!path) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
};

const writeRunReports = async (reportDir: string | undefined, summary: RunSummary): Promise<void> => {
  if (!reportDir) {
    return;
  }
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "scorel-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(reportDir, "scorel-events.jsonl"), summary.events?.map((event) => JSON.stringify(event)).join("\n").concat("\n") ?? "");
  await writeFile(join(reportDir, "scorel-metadata.json"), `${JSON.stringify(runMetadata(summary), null, 2)}\n`);
  await writeFile(join(reportDir, "scorel-trajectory.json"), `${JSON.stringify(runTrajectory(summary), null, 2)}\n`);
};

const runReportPaths = (options: RunOptions): Record<string, string> => {
  const reports: Record<string, string> = {
    sessionJsonl: join(options.sessionsDir, `${options.sessionId}.jsonl`),
    sessionSummary: sessionObservationSummaryFilePath(options.sessionsDir, options.sessionId),
    diagnosticsLog: sessionLogFilePath(options.sessionsDir, options.sessionId),
    sessionFilesDir: sessionArtifactsDirPath(options.sessionsDir, options.sessionId),
  };
  if (options.reportDir) {
    reports.summary = join(options.reportDir, "scorel-summary.json");
    reports.events = join(options.reportDir, "scorel-events.jsonl");
    reports.trajectory = join(options.reportDir, "scorel-trajectory.json");
    reports.metadata = join(options.reportDir, "scorel-metadata.json");
  }
  return reports;
};

const runMetadata = (summary: RunSummary): Record<string, unknown> => ({
  format: "scorel-run-metadata-v1",
  status: summary.status,
  exitReason: summary.exitReason,
  sessionId: summary.sessionId,
  projectId: summary.projectId,
  cwd: summary.cwd,
  elapsedMs: summary.elapsedMs,
  usage: summary.usage,
  model: summary.model,
  cost: summary.cost,
  reports: summary.reports,
});

const runTrajectory = (summary: RunSummary): Record<string, unknown> => ({
  format: "scorel-run-trajectory-v1",
  sessionId: summary.sessionId,
  projectId: summary.projectId,
  status: summary.status,
  usage: summary.usage,
  model: summary.model,
  cost: summary.cost,
  events: summary.events ?? [],
});

const runReportingModel = (config: ScorelConfig, modelSelection: ModelSelectionInput | undefined): RunReportingModel | undefined => {
  try {
    const selection = resolveModelSelection(config, modelSelection);
    const model = resolvePiAiModel(selection.config);
    return {
      modelId: selection.modelId,
      providerModelId: model.id,
      provider: model.provider,
      api: model.api,
      displayName: selection.displayName,
    };
  } catch {
    return modelSelection?.modelId ? { modelId: modelSelection.modelId } : undefined;
  }
};

const readRunPrompt = async (options: RunOptions, io: CliIo): Promise<string> => {
  if (options.promptSource === "prompt-file") {
    return (await readFile(options.promptFile!, "utf8")).trim();
  }
  if (options.promptSource === "stdin") {
    const chunks: Buffer[] = [];
    for await (const chunk of io.input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return (options.prompt ?? "").trim();
};

const resolveRunConfig = (options: RunOptions): ScorelConfig | undefined => {
  const override = options.providerOverride;
  if (!override || (!override.provider && !override.api && !override.baseUrl && !override.apiKey)) {
    return undefined;
  }
  if (!override.baseUrl) {
    throw new Error("--base-url is required when overriding the run provider");
  }
  if (!override.apiKey) {
    throw new Error("--api-key is required when overriding the run provider");
  }
  if (!options.modelSelection?.modelId) {
    throw new Error("--model <model-id> is required when overriding the run provider");
  }
  const providerId = "run";
  const providerModelId = "run_model";
  const availableModelId = options.modelSelection.modelId;
  return {
    providers: {
      [providerId]: {
        type: "custom",
        api: override.api ?? "openai-completions",
        provider: override.provider ?? "openai",
        baseUrl: stripTrailingSlashes(override.baseUrl),
        apiKey: override.apiKey,
      },
    },
    providerModels: {
      [providerModelId]: {
        provider: providerId,
        id: availableModelId,
        displayName: availableModelId,
      },
    },
    models: {
      [availableModelId]: {
        model: providerModelId,
        displayName: availableModelId,
      },
    },
    modelProfile: {
      roles: {
        primary: availableModelId,
        standard: availableModelId,
        auxiliary: availableModelId,
      },
    },
    memory: {
      enabled: false,
      daily: false,
      sessionMemory: false,
      autoDream: false,
      promoteRoot: false,
      dreamIdleMinutes: 60,
      autoCompactThreshold: 0.8,
    },
    runtime: {
      tokenSavingRtk: false,
    },
    extensions: {},
  };
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

const runObserve = async (options: ObserveSyncOptions, io: CliIo): Promise<number> => {
  const session = await loadSession({ sessionsDir: options.sessionsDir, sessionId: options.sessionId });
  const asset = buildObservationAsset(session);

  if (options.target === "langfuse") {
    const payload = buildLangfuseSyncPayload(asset);
    await writeObservePayload(options.outPath, payload);
    const config = options.config ?? await loadObserveConfig(options);
    const langfuse = config?.observability?.langfuse;
    let uploaded = false;
    if (langfuse?.enabled && langfuse.publicKey && langfuse.secretKey) {
      await uploadLangfusePayload({
        host: langfuse.host ?? "https://cloud.langfuse.com",
        publicKey: langfuse.publicKey,
        secretKey: langfuse.secretKey,
        payload,
      });
      uploaded = true;
    } else if (!options.outPath) {
      throw new Error("Langfuse credentials are not configured; set observability.langfuse publicKey/secretKey or pass --out to inspect the payload");
    }
    if (uploaded) {
      await writeObservabilitySyncState(options.stateDir, "langfuse", asset.assetId, {
        target: "langfuse",
        assetId: asset.assetId,
        lastExportedSeq: asset.currentSeq,
        lastRevision: asset.revision,
        updatedAt: Date.now(),
      });
    }
    io.output.write(`target=langfuse asset=${asset.assetId} revision=${asset.revision} events=${payload.batch.length} uploaded=${uploaded}\n`);
    return 0;
  }

  const state = await readObservabilitySyncState(options.stateDir, "otel", asset.assetId);
  const payload = buildOtelDeltaPayload(asset, state);
  await writeObservePayload(options.outPath, payload);
  const config = options.config ?? await loadObserveConfig(options);
  const otel = config?.observability?.otel;
  const hasOtelEndpoint = Boolean(otel?.enabled && otel.endpoint);
  let uploaded = false;
  if (hasOtelEndpoint && payload.events.length > 0 && otel?.endpoint) {
    await uploadOtelPayload({ endpoint: otel.endpoint, payload: payload.otlp });
    uploaded = true;
  } else if (!hasOtelEndpoint && !options.outPath) {
    throw new Error("OpenTelemetry endpoint is not configured; set observability.otel.endpoint or pass --out to inspect the payload");
  }
  if (hasOtelEndpoint) {
    await writeObservabilitySyncState(options.stateDir, "otel", asset.assetId, payload.nextState);
  }
  io.output.write(`target=otel asset=${asset.assetId} fromSeq=${payload.fromSeq} toSeq=${payload.toSeq} events=${payload.events.length} uploaded=${uploaded}\n`);
  return 0;
};

const writeObservePayload = async (path: string | undefined, payload: unknown): Promise<void> => {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (!path) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
};

const loadObserveConfig = async (options: Pick<ObserveSyncOptions, "stateDir">): Promise<ScorelConfig | undefined> => {
  try {
    return await loadScorelConfig({ cwd: process.cwd(), scorelHomeDir: options.stateDir });
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") {
      return undefined;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("No Scorel config") || message.includes("Scorel config not found")) {
      return undefined;
    }
    throw cause;
  }
};

export type SigintHandlerOptions = {
  /** Returns true when a chat turn is mid-flight; daemon should be cancelled. */
  isInFlight: () => boolean;
  /** Best-effort daemon cancel (no rejection surfaces). */
  cancel: () => Promise<void>;
  /** Stream to write the cancellation marker to. */
  output: NodeJS.WritableStream;
  /** Called when the handler decides to exit the REPL (idle Ctrl-C). */
  exit: () => void;
};

/**
 * Build a SIGINT handler that cancels in-flight turns without exiting; a
 * subsequent SIGINT during idle exits via `exit`. Factored out so unit tests
 * can drive it without poking real process signals.
 */
export const createSigintHandler = (options: SigintHandlerOptions): () => void => {
  return () => {
    if (options.isInFlight()) {
      options.output.write("\n[cancelled]\n");
      void options.cancel().catch(() => undefined);
      return;
    }
    options.exit();
  };
};

const loadOrCreateSession = async (
  client: DaemonClient,
  sessionId: SessionId,
  projectId: ReturnType<typeof asProjectId>,
  modelSelection?: ModelSelectionInput,
): Promise<boolean> => {
  try {
    await client.loadSession(sessionId);
    return true;
  } catch {
    await client.createSession({
      sessionId,
      meta: { projectId, ...(modelSelection ? { modelSelection } : {}) },
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

const parseRunOptions = (argv: string[], runOptions: CliRunOptions): RunOptions => {
  const promptSources: Array<Pick<RunOptions, "promptSource" | "prompt" | "promptFile">> = [];
  let sessionId = asSessionId(`ses_run_${Date.now().toString(36)}`);
  let cwd = process.cwd();
  let stateDir: string | undefined;
  let sessionsDir: string | undefined = runOptions.sessionsDir;
  let timeoutMs: number | undefined;
  let outputFormat: RunOutputFormat = "text";
  let summaryPath: string | undefined;
  let reportDir: string | undefined;
  let quiet = false;
  let modelSelection: ModelSelectionInput | undefined;
  const providerOverride: RunProviderOverride = {};
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prompt") {
      promptSources.push({ promptSource: "prompt", prompt: requireValue(argv, index, "--prompt") });
      index += 1;
      continue;
    }
    if (arg === "--prompt-file") {
      promptSources.push({ promptSource: "prompt-file", promptFile: requireValue(argv, index, "--prompt-file") });
      index += 1;
      continue;
    }
    if (arg === "--stdin") {
      promptSources.push({ promptSource: "stdin" });
      continue;
    }
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
    if (arg === "--state-dir") {
      stateDir = requireValue(argv, index, "--state-dir");
      index += 1;
      continue;
    }
    if (arg === "--sessions-dir") {
      sessionsDir = requireValue(argv, index, "--sessions-dir");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger(requireValue(argv, index, "--timeout-ms"), "--timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--output-format") {
      outputFormat = parseRunOutputFormat(requireValue(argv, index, "--output-format"));
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      summaryPath = requireValue(argv, index, "--summary");
      index += 1;
      continue;
    }
    if (arg === "--report-dir") {
      reportDir = requireValue(argv, index, "--report-dir");
      index += 1;
      continue;
    }
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--model") {
      modelSelection = parseModelSelection(requireValue(argv, index, "--model"));
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      providerOverride.provider = requireValue(argv, index, "--provider");
      index += 1;
      continue;
    }
    if (arg === "--api" || arg === "--protocol") {
      providerOverride.api = parseRunProviderApi(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--base-url" || arg === "--baseurl") {
      providerOverride.baseUrl = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--api-key" || arg === "--apikey") {
      providerOverride.apiKey = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown run option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    promptSources.unshift({ promptSource: "argument", prompt: positional.join(" ") });
  }
  if (promptSources.length !== 1) {
    throw new Error("scorel run requires exactly one prompt source");
  }

  const resolvedStateDir = stateDir ?? stateDirFromSessionsDir(sessionsDir);
  const resolvedSessionsDir = sessionsDir ?? join(resolvedStateDir, "sessions");
  return {
    ...promptSources[0],
    sessionId,
    cwd,
    stateDir: resolvedStateDir,
    sessionsDir: resolvedSessionsDir,
    timeoutMs,
    outputFormat,
    summaryPath,
    reportDir,
    quiet,
    modelSelection,
    providerOverride,
    config: runOptions.config,
  };
};

const parseRunOutputFormat = (value: string): RunOutputFormat => {
  if (value === "text" || value === "json" || value === "stream-json" || value === "none") {
    return value;
  }
  throw new Error("--output-format must be text, json, stream-json, or none");
};

const parsePositiveInteger = (value: string, flag: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
};

const parseModelSelection = (value: string): ModelSelectionInput => {
  if (value === "primary" || value === "standard" || value === "auxiliary") {
    return { role: value as ModelRole };
  }
  return { modelId: value };
};

const parseRunProviderApi = (value: string): RunProviderApi => {
  if (
    value === "openai-completions" ||
    value === "openai-responses" ||
    value === "google-generative-ai" ||
    value === "anthropic-messages"
  ) {
    return value;
  }
  throw new Error("--api must be openai-completions, openai-responses, google-generative-ai, or anthropic-messages");
};

const parseObserveOptions = (argv: string[], runOptions: CliRunOptions): ObserveSyncOptions => {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "sync") {
    throw new Error("scorel observe requires sync");
  }
  let sessionId: SessionId | undefined;
  let target: ObserveSyncTarget | undefined;
  let sessionsDir: string | undefined = runOptions.sessionsDir;
  let stateDir: string | undefined;
  let outPath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--session") {
      sessionId = asSessionId(requireValue(rest, index, "--session"));
      index += 1;
      continue;
    }
    if (arg === "--target") {
      target = parseObserveTarget(requireValue(rest, index, "--target"));
      index += 1;
      continue;
    }
    if (arg === "--sessions-dir") {
      sessionsDir = requireValue(rest, index, "--sessions-dir");
      index += 1;
      continue;
    }
    if (arg === "--state-dir") {
      stateDir = requireValue(rest, index, "--state-dir");
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outPath = requireValue(rest, index, "--out");
      index += 1;
      continue;
    }
    throw new Error(`Unknown observe option: ${arg}`);
  }

  if (!sessionId) {
    throw new Error("--session is required");
  }
  if (!target) {
    throw new Error("--target is required");
  }
  const resolvedStateDir = stateDir ?? stateDirFromSessionsDir(sessionsDir);
  const resolvedSessionsDir = sessionsDir ?? join(resolvedStateDir, "sessions");
  return {
    command: "sync",
    sessionId,
    target,
    sessionsDir: resolvedSessionsDir,
    stateDir: resolvedStateDir,
    outPath,
    config: runOptions.config,
  };
};

const parseObserveTarget = (value: string): ObserveSyncTarget => {
  if (value === "langfuse" || value === "otel") {
    return value;
  }
  throw new Error("--target must be langfuse or otel");
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
  output.write(
    [
      "Usage: scorel chat [--session <id>] [--cwd <dir>]",
      "       scorel [--session <id>] [--cwd <dir>]",
      "       scorel run [prompt] [--prompt <text> | --prompt-file <path> | --stdin]",
      "                 [--cwd <dir>] [--state-dir <dir>] [--sessions-dir <dir>]",
      "                 [--session <id>] [--timeout-ms <ms>]",
      "                 [--output-format text|json|stream-json|none] [--summary <path>]",
      "                 [--provider <name>] [--api|--protocol <protocol>]",
      "                 [--base-url|--baseurl <url>] [--api-key|--apikey <key>] [--model <id>]",
      "       scorel attach --session <id> --remote <ws-url> --token <token>",
      "       scorel host start [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
      "                        [--relay <relay-url> | --no-relay] [--replace] [--idle-timeout-ms <ms>]",
      "       scorel host serve [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
      "                        [--relay <relay-url> | --no-relay] [--replace] [--idle-timeout-ms <ms>]",
      "       scorel host status [--show-token]",
      "       scorel host stop",
      "       scorel host reset",
      "       scorel pair <pair-code> [--relay <relay-url>]",
      "       scorel relay serve [--host <h>] [--port <p>] [--data-dir <dir>]",
      "       scorel webui [--port <p>] [--host <h>]",
      "       scorel up [--daemon-port <p>] [--webui-port <p>] [--cwd <d>]",
      "       scorel update",
      "       scorel upgrade",
      "       scorel version",
      "       scorel logs [--attach] --session <id> [--remote <ws-url>] [--tail <n>]",
      "       scorel observe sync --session <id> --target langfuse|otel [--out <path>]",
      "       scorel project list",
      "       scorel project add <dir>",
      "       scorel project remove <project-id>",
    ].join("\n") + "\n",
  );
};

const writeRunUsage = (output: NodeJS.WritableStream): void => {
  output.write(
    [
      "Usage: scorel run [prompt]",
      "       scorel run --prompt <text>",
      "       scorel run --prompt-file <path>",
      "       scorel run --stdin",
      "",
      "Options:",
      "  --cwd <dir>",
      "  --state-dir <dir>",
      "  --sessions-dir <dir>",
      "  --session <id>",
      "  --timeout-ms <ms>",
      "  --output-format text|json|stream-json|none",
      "  --summary <path>",
      "  --report-dir <path>",
      "  --quiet",
      "  --model <primary|standard|auxiliary|model-id>",
      "  --provider <name>",
      "  --api, --protocol <openai-completions|openai-responses|google-generative-ai|anthropic-messages>",
      "  --base-url, --baseurl <url>",
      "  --api-key, --apikey <key>",
      "",
      "Examples:",
      '  scorel run --prompt "Summarize this project" --output-format json',
      "  scorel run --prompt-file /tmp/instruction.txt --cwd /workspace --state-dir /tmp/scorel-state \\",
      "    --api openai-completions --baseurl http://127.0.0.1:4000/v1 --apikey \"$API_KEY\" \\",
      "    --model gpt-5.4-mini --output-format none --summary /logs/agent/scorel-summary.json",
    ].join("\n") + "\n",
  );
};

const writeObserveUsage = (output: NodeJS.WritableStream): void => {
  output.write(
    [
      "Usage: scorel observe sync --session <id> --target langfuse|otel",
      "",
      "Options:",
      "  --state-dir <dir>",
      "  --sessions-dir <dir>",
      "  --out <path>",
    ].join("\n") + "\n",
  );
};

const writeProjectUsage = (output: NodeJS.WritableStream): void => {
  output.write("Usage: scorel project list | add <dir> | remove <project-id>\n");
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
    .flatMap((block): string[] => {
      if (block.type === "text") {
        if (block.visibility === "model") {
          return [];
        }
        return [block.text];
      }
      if (block.type === "system_reminder" && block.visibility !== "model") {
        return [block.text];
      }
      return [];
    })
    .join("");

const isCliEntrypoint = async (): Promise<boolean> => {
  if (!process.argv[1]) return false;
  const [argvPath, modulePath] = await Promise.all([
    realpath(process.argv[1]).catch(() => process.argv[1]),
    realpath(fileURLToPath(import.meta.url)).catch(() => fileURLToPath(import.meta.url)),
  ]);
  return argvPath === modulePath;
};

if (process.env.SCOREL_SKIP_INDEX_ENTRY !== "1" && await isCliEntrypoint()) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
