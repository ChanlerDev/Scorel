import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ScorelHost,
  createLocalDaemonState,
  createRealRuntime,
  daemonStateLiveness,
  loadOrCreateHostDeviceIdentity,
  loadScorelConfig,
  loadScorelConfigProfile,
  markDaemonStopped,
  readLocalDaemonState,
  removeLocalDaemonState,
  scorelSessionsDir,
  startHostRelayClient,
  startScorelHostWebSocketServer,
  type DaemonStateLiveness,
  type HostRelayClient,
  type LocalDaemonState,
} from "@scorel/daemon";

import { DEFAULT_SCOREL_WEBUI_URL, resolveDefaultRelayUrl } from "./relay-cli.js";
import {
  AUTO_UPDATE_INTERVAL_MS,
  createNpmPackageUpdater,
  readInstalledScorelVersion,
  shouldRunAutoUpdate,
  type PackageUpdater,
} from "./update-cli.js";

export type DaemonCommandIo = {
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
};

export type DaemonCommandOptions = DaemonCommandIo & {
  stateDir?: string;
  sessionsDir?: string;
  cwd?: string;
  /**
   * Optional override for `serve` shutdown so tests don't have to wire up
   * real OS signals. When set, the embedded daemon stops as soon as the
   * signal aborts.
   */
  serveSignal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  spawn?: (command: string, argv: string[], opts: SpawnOptions) => ChildProcess;
  cliEntrypoint?: string;
  daemonReadyTimeoutMs?: number;
  readState?: (stateDir: string) => Promise<LocalDaemonState | null>;
  packageUpdater?: PackageUpdater;
  autoUpdateIntervalMs?: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const STOP_POLL_INTERVAL_MS = 200;
const STOP_GRACE_MS = 5000;
const START_READY_TIMEOUT_MS = 30_000;
type DaemonLaunchIntent = "attached" | "user_started";

const defaultStateDir = (): string => join(homedir(), ".scorel");

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "::1" || host === "localhost";

const formatTimestamp = (epochMs: number): string => new Date(epochMs).toISOString();

export const runCliDaemon = async (
  argv: string[],
  options: DaemonCommandOptions,
): Promise<number> => {
  const [command, ...rest] = argv;
  const stateDir = options.stateDir ?? defaultStateDir();
  switch (command) {
    case "start":
      return runStartCommand(rest, { ...options, stateDir });
    case "serve":
      return runServeCommand(rest, { ...options, stateDir });
    case "status":
      return runStatusCommand(rest, { ...options, stateDir });
    case "stop":
      return runStopCommand(rest, { ...options, stateDir });
    case "reset":
      return runResetCommand({ ...options, stateDir });
    case "--help":
    case "-h":
      writeDaemonUsage(options.output);
      return 0;
    default:
      writeDaemonUsage(options.error);
      return 1;
  }
};

const runStartCommand = async (
  argv: string[],
  options: DaemonCommandOptions & { stateDir: string },
): Promise<number> => {
  let flags: ServeFlags;
  try {
    flags = parseServeFlags(argv, options.cwd ?? process.cwd(), options.env ?? process.env, "user_started");
  } catch (cause) {
    options.error.write(`scorel daemon start error: ${(cause as Error).message}\n`);
    return 1;
  }

  const readState = options.readState ?? ((stateDir: string) => readLocalDaemonState({ stateDir }));
  const existing = await readState(options.stateDir);
  if (existing && daemonStateLiveness(existing) === "running") {
    options.output.write(`scorel host already running url=${existing.wsUrl} pid=${existing.pid}\n`);
    return 0;
  }

  const cliEntrypoint = options.cliEntrypoint ?? fileURLToPath(import.meta.url).replace(/daemon-cli\.ts$/, "index.ts");
  const child = (options.spawn ?? spawn)(process.execPath, [
    ...nodeEntrypointArgs(cliEntrypoint),
    "host",
    "serve",
    "--host",
    flags.host,
    "--port",
    String(flags.port),
    "--cwd",
    flags.cwd,
    "--lifetime",
    flags.launchIntent,
    ...(flags.token ? ["--token", flags.token] : []),
    ...(flags.relayUrl ? ["--relay", flags.relayUrl] : ["--no-relay"]),
    ...(flags.replace ? ["--replace"] : []),
  ], {
    cwd: dirname(cliEntrypoint),
    env: { ...process.env, ...(options.env ?? {}) },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForDaemonReady(child, options.daemonReadyTimeoutMs ?? START_READY_TIMEOUT_MS);
  } catch (cause) {
    options.error.write(`scorel daemon start error: ${(cause as Error).message}\n`);
    child.kill("SIGTERM");
    return 1;
  }

  const state = await readState(options.stateDir);
  if (!state || daemonStateLiveness(state) !== "running") {
    options.error.write("scorel daemon start error: daemon state missing after start\n");
    child.kill("SIGTERM");
    return 1;
  }
  detachBackgroundDaemon(child);
  options.output.write(`scorel host started url=${state.wsUrl} pid=${state.pid}\n`);
  return 0;
};

type ServeFlags = {
  host: string;
  port: number;
  token?: string;
  cwd: string;
  relayUrl?: string;
  replace: boolean;
  launchIntent: DaemonLaunchIntent;
};

const runServeCommand = async (
  argv: string[],
  options: DaemonCommandOptions & { stateDir: string },
): Promise<number> => {
  let flags: ServeFlags;
  try {
    flags = parseServeFlags(argv, options.cwd ?? process.cwd(), options.env ?? process.env, "user_started");
  } catch (cause) {
    options.error.write(`scorel daemon serve error: ${(cause as Error).message}\n`);
    return 1;
  }

  const existing = await readLocalDaemonState({ stateDir: options.stateDir });
  if (existing) {
    const liveness = daemonStateLiveness(existing);
    if (liveness === "running") {
      if (flags.replace) {
        await stopRunningDaemon(existing, options);
      } else {
      options.error.write(
        `scorel host already running pid=${existing.pid} url=${existing.wsUrl}\nUse --replace to stop it and start a new one.\n`,
      );
      return 1;
      }
    }
  }

  const token = flags.token ?? existing?.token ?? randomUUID();
  const identity = await loadOrCreateHostDeviceIdentity({ stateDir: options.stateDir });
  const configScope = { scorelHomeDir: options.stateDir };
  let signalReason: string = "natural";
  let resolveStopWaiter: (() => void) | undefined;
  let stopRequested = false;
  const requestStop = (reason: string): void => {
    signalReason = reason;
    stopRequested = true;
    resolveStopWaiter?.();
  };
  const sessionsDir = options.sessionsDir ?? scorelSessionsDir(homedir());
  const daemon = new ScorelHost({
    sessionsDir,
    projectsPath: join(options.stateDir, "projects.json"),
    deviceId: identity.deviceId,
    deviceDisplayName: identity.displayName,
    ...(flags.launchIntent === "attached" ? { onLastClientDisconnect: () => requestStop("last-client-disconnected") } : {}),
    scorelHomeDir: options.stateDir,
    loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, ...configScope }),
    loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, ...configScope }),
    createRuntime: async ({ sessionId, project, selectedModel, purpose }) => createRealRuntime({
      cwd: project.workDir,
      config: await loadScorelConfig({ cwd: project.workDir, ...configScope }),
      sessionsDir,
      sessionId,
      modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : undefined,
      includeTools: purpose === "chat",
    }),
  });
  await daemon.start();
  await daemon.registerProject(flags.cwd);
  const autoUpdater = await startAutoUpdateLoop({
    host: daemon,
    requestStop,
    output: options.output,
    error: options.error,
    updater: options.packageUpdater,
    intervalMs: options.autoUpdateIntervalMs ?? AUTO_UPDATE_INTERVAL_MS,
  });

  const server = await startScorelHostWebSocketServer({
    hostService: daemon,
    host: flags.host,
    port: flags.port,
    token,
  });

  const startedAt = Date.now();
  // Persist with the actual bound port (server.port reflects 0 → ephemeral
  // assignment) so `status` and clients always see the truth.
  const persistedState: LocalDaemonState = {
    host: flags.host,
    port: server.port,
    wsUrl: server.url,
    token,
    pid: process.pid,
    startedAt,
    stoppedAt: null,
    launchIntent: flags.launchIntent,
  };
  await createLocalDaemonState({ stateDir: options.stateDir, ...persistedState });

  options.output.write(`scorel host serving url=${server.url}\n`);
  options.output.write(`scorel host initial project cwd=${flags.cwd}\n`);
  let relayClient: HostRelayClient | undefined;
  if (flags.relayUrl) {
    relayClient = await startHostRelayClient({
      relayUrl: flags.relayUrl,
      hostService: daemon,
      deviceId: identity.deviceId,
      deviceDisplayName: identity.displayName,
      stateDir: options.stateDir,
      onDiagnostic: (type) => {
        if (type === "relay_host_connected") {
          options.output.write(`scorel host relay connected url=${flags.relayUrl} device=${identity.deviceId}\n`);
          options.output.write(`scorel hosted webui ${DEFAULT_SCOREL_WEBUI_URL}\n`);
        }
        if (type === "relay_host_reconnecting") {
          options.output.write(`scorel host relay reconnecting url=${flags.relayUrl} device=${identity.deviceId}\n`);
        }
      },
    });
  }

  const shutdown = async (): Promise<void> => {
    try {
      autoUpdater.stop();
      relayClient?.close();
      await server.close();
    } finally {
      await daemon.shutdown();
      await markDaemonStopped({ stateDir: options.stateDir, stoppedAt: Date.now() });
    }
  };

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const stopWaiter = new Promise<void>((resolve) => {
    resolveStopWaiter = resolve;
    if (stopRequested) {
      resolve();
      return;
    }
    if (options.serveSignal) {
      if (options.serveSignal.aborted) {
        requestStop("abort");
        return;
      }
      options.serveSignal.addEventListener(
        "abort",
        () => {
          requestStop("abort");
        },
        { once: true },
      );
      return;
    }
    const installSignal = (signal: NodeJS.Signals) => {
      const handler = () => {
        requestStop(signal);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    };
    installSignal("SIGINT");
    installSignal("SIGTERM");
  });

  try {
    await stopWaiter;
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    await shutdown();
  }

  options.output.write(`scorel host serve stopped reason=${signalReason}\n`);
  return 0;
};

const startAutoUpdateLoop = async (options: {
  host: ScorelHost;
  requestStop: (reason: string) => void;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  updater?: PackageUpdater;
  intervalMs: number;
}): Promise<{ stop(): void }> => {
  const updater = options.updater ?? createNpmPackageUpdater({ currentVersion: await readInstalledScorelVersion() });
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const activity = options.host.activityStatus();
      if (!shouldRunAutoUpdate({ ...activity, now: Date.now() })) {
        return;
      }
      const result = await updater.update();
      if (result.status === "updated") {
        options.output.write(`scorel auto-updated ${result.currentVersion} -> ${result.latestVersion}; restarting host\n`);
        options.requestStop("auto-update");
      }
    } catch (cause) {
      options.error.write(`scorel auto-update error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), options.intervalMs);
  timer.unref?.();
  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
};

const stopRunningDaemon = async (
  state: LocalDaemonState,
  options: DaemonCommandOptions & { stateDir: string },
): Promise<void> => {
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    await sleep(STOP_POLL_INTERVAL_MS);
    const refreshed = await readLocalDaemonState({ stateDir: options.stateDir });
    if (!refreshed || refreshed.stoppedAt !== null || daemonStateLiveness(refreshed) !== "running") {
      return;
    }
  }
  try {
    process.kill(state.pid, "SIGKILL");
  } catch {
    // The process may have exited after the grace timeout.
  }
};

type StatusFlags = {
  showToken: boolean;
};

const runStatusCommand = async (
  argv: string[],
  options: DaemonCommandOptions & { stateDir: string },
): Promise<number> => {
  let flags: StatusFlags;
  try {
    flags = parseStatusFlags(argv);
  } catch (cause) {
    options.error.write(`scorel daemon status error: ${(cause as Error).message}\n`);
    return 1;
  }
  const state = await readLocalDaemonState({ stateDir: options.stateDir });
  if (!state) {
    options.error.write("scorel daemon not configured\n");
    return 1;
  }
  const liveness = daemonStateLiveness(state);
  options.output.write(`${formatStatusLine(state, liveness, flags.showToken)}\n`);
  return 0;
};

const runStopCommand = async (
  _argv: string[],
  options: DaemonCommandOptions & { stateDir: string },
): Promise<number> => {
  const state = await readLocalDaemonState({ stateDir: options.stateDir });
  if (!state) {
    options.error.write("scorel daemon not configured\n");
    return 1;
  }
  const liveness = daemonStateLiveness(state);
  if (liveness !== "running") {
    options.output.write(
      `scorel daemon already stopped pid=${state.pid} liveness=${liveness}\n`,
    );
    return 0;
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (cause) {
    options.error.write(
      `scorel daemon stop error: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
  // Wait for graceful shutdown to flip stoppedAt; force-kill after 5s.
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    await sleep(STOP_POLL_INTERVAL_MS);
    const refreshed = await readLocalDaemonState({ stateDir: options.stateDir });
    if (!refreshed) {
      break;
    }
    if (refreshed.stoppedAt !== null) {
      options.output.write(`scorel daemon stopped pid=${refreshed.pid}\n`);
      return 0;
    }
    const refreshedLiveness = daemonStateLiveness(refreshed);
    if (refreshedLiveness !== "running") {
      options.output.write(
        `scorel daemon stopped pid=${refreshed.pid} liveness=${refreshedLiveness}\n`,
      );
      return 0;
    }
  }
  try {
    process.kill(state.pid, "SIGKILL");
  } catch {
    // Process may have exited between SIGTERM and the timeout.
  }
  options.output.write(`scorel daemon stopped pid=${state.pid} via=SIGKILL\n`);
  return 0;
};

const runResetCommand = async (
  options: DaemonCommandOptions & { stateDir: string },
): Promise<number> => {
  await removeLocalDaemonState({ stateDir: options.stateDir });
  options.output.write("scorel daemon state reset; next serve will generate a new token\n");
  return 0;
};

const formatStatusLine = (
  state: LocalDaemonState,
  liveness: DaemonStateLiveness,
  showToken: boolean,
): string => {
  if (liveness === "running") {
    const tokenSuffix = isLoopbackHost(state.host) || showToken ? ` token=${state.token}` : "";
    return `running url=${state.wsUrl} pid=${state.pid} lifetime=${state.launchIntent}${tokenSuffix}`;
  }
  const stoppedAt =
    state.stoppedAt !== null ? formatTimestamp(state.stoppedAt) : "unknown";
  return `stopped url=${state.wsUrl} last-pid=${state.pid} stoppedAt=${stoppedAt} liveness=${liveness}`;
};

const parseServeFlags = (argv: string[], defaultCwd: string, env: NodeJS.ProcessEnv, defaultLaunchIntent: DaemonLaunchIntent): ServeFlags => {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let cwd = defaultCwd;
  let token: string | undefined;
  let relayUrl: string | undefined = resolveDefaultRelayUrl(env);
  let replace = false;
  let launchIntent = defaultLaunchIntent;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      host = requireValue(argv, index, "--host");
      index += 1;
      continue;
    }
    if (arg === "--port") {
      port = Number(requireValue(argv, index, "--port"));
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port must be an integer from 0 to 65535");
      }
      index += 1;
      continue;
    }
    if (arg === "--token") {
      token = requireValue(argv, index, "--token");
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      cwd = requireValue(argv, index, "--cwd");
      index += 1;
      continue;
    }
    if (arg === "--project" || arg === "--bootstrap-project") {
      cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--relay") {
      relayUrl = requireValue(argv, index, "--relay");
      index += 1;
      continue;
    }
    if (arg === "--no-relay") {
      relayUrl = undefined;
      continue;
    }
    if (arg === "--replace") {
      replace = true;
      continue;
    }
    if (arg === "--lifetime") {
      const value = requireValue(argv, index, "--lifetime");
      if (value !== "attached" && value !== "user_started") {
        throw new Error("--lifetime must be attached or user_started");
      }
      launchIntent = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown serve option: ${arg}`);
  }
  return { host, port, token, cwd, relayUrl, replace, launchIntent };
};

const parseStatusFlags = (argv: string[]): StatusFlags => {
  let showToken = false;
  for (const arg of argv) {
    if (arg === "--show-token") {
      showToken = true;
      continue;
    }
    throw new Error(`Unknown status option: ${arg}`);
  }
  return { showToken };
};

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForDaemonReady = (child: ChildProcess, timeoutMs: number): Promise<void> =>
  new Promise((resolveReady, rejectReady) => {
    if (!child.stdout) {
      rejectReady(new Error("daemon child has no stdout stream"));
      return;
    }
    let buffer = "";
    let stderrBuffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectReady(new Error("timed out waiting for daemon ready line"));
    }, timeoutMs);
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (!buffer.includes("\n")) return;
      if (buffer.includes("scorel daemon serving url=") || buffer.includes("scorel host serving url=")) {
        if (settled) return;
        settled = true;
        cleanup();
        resolveReady();
      }
      const newlineIndex = buffer.lastIndexOf("\n");
      buffer = newlineIndex >= 0 ? buffer.slice(newlineIndex + 1) : buffer;
    };
    const onStderr = (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    };
    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      const trimmed = stderrBuffer.trim();
      const detail = trimmed ? `: ${trimmed}` : "";
      rejectReady(new Error(`daemon exited before ready code=${code}${detail}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });

const detachBackgroundDaemon = (child: ChildProcess): void => {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
};

const nodeEntrypointArgs = (entrypoint: string): string[] =>
  entrypoint.endsWith(".ts") ? ["--import", "tsx", entrypoint] : [entrypoint];

const writeDaemonUsage = (output: NodeJS.WritableStream): void => {
  output.write(
    [
      "Usage: scorel host serve [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
      "                        [--relay <relay-url> | --no-relay] [--replace]",
      "       scorel host start [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
      "                        [--relay <relay-url> | --no-relay] [--replace]",
      "       scorel host status [--show-token]",
      "       scorel host stop",
      "       scorel host reset",
      "       scorel daemon ...  # pre-1.0 alias",
    ].join("\n") + "\n",
  );
};
