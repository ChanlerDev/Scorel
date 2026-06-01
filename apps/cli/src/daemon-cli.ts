import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ScorelHost,
  createLocalDaemonState,
  createRealRuntime,
  daemonStateLiveness,
  loadScorelConfig,
  markDaemonStopped,
  readLocalDaemonState,
  removeLocalDaemonState,
  scorelSessionsDir,
  startScorelHostWebSocketServer,
  type DaemonStateLiveness,
  type LocalDaemonState,
} from "@scorel/daemon";
import { asDeviceId } from "@scorel/protocol";

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
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const STOP_POLL_INTERVAL_MS = 200;
const STOP_GRACE_MS = 5000;

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

type ServeFlags = {
  host: string;
  port: number;
  token?: string;
  cwd: string;
};

const runServeCommand = async (
  argv: string[],
  options: DaemonCommandOptions & { stateDir: string },
): Promise<number> => {
  let flags: ServeFlags;
  try {
    flags = parseServeFlags(argv, options.cwd ?? process.cwd());
  } catch (cause) {
    options.error.write(`scorel daemon serve error: ${(cause as Error).message}\n`);
    return 1;
  }

  const existing = await readLocalDaemonState({ stateDir: options.stateDir });
  if (existing) {
    const liveness = daemonStateLiveness(existing);
    if (liveness === "running") {
      options.error.write(
        `scorel daemon already running pid=${existing.pid} url=${existing.wsUrl}\n`,
      );
      return 1;
    }
  }

  const token = flags.token ?? existing?.token ?? randomUUID();
  const daemon = new ScorelHost({
    sessionsDir: options.sessionsDir ?? scorelSessionsDir(homedir()),
    projectsPath: join(options.stateDir, "projects.json"),
    deviceId: asDeviceId("device_local"),
    deviceDisplayName: "Local daemon",
    createRuntime: async ({ project }) => createRealRuntime({
      cwd: project.workDir,
      config: await loadScorelConfig({ cwd: project.workDir }),
    }),
  });
  await daemon.start();
  await daemon.registerProject(flags.cwd);

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
  };
  await createLocalDaemonState({ stateDir: options.stateDir, ...persistedState });

  options.output.write(`scorel daemon serving url=${server.url}\n`);

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
    } finally {
      await daemon.shutdown();
      await markDaemonStopped({ stateDir: options.stateDir, stoppedAt: Date.now() });
    }
  };

  let signalReason: string = "natural";
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const stopWaiter = new Promise<void>((resolve) => {
    if (options.serveSignal) {
      if (options.serveSignal.aborted) {
        signalReason = "abort";
        resolve();
        return;
      }
      options.serveSignal.addEventListener(
        "abort",
        () => {
          signalReason = "abort";
          resolve();
        },
        { once: true },
      );
      return;
    }
    const installSignal = (signal: NodeJS.Signals) => {
      const handler = () => {
        signalReason = signal;
        resolve();
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

  options.output.write(`scorel daemon serve stopped reason=${signalReason}\n`);
  return 0;
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
    return `running url=${state.wsUrl} pid=${state.pid}${tokenSuffix}`;
  }
  const stoppedAt =
    state.stoppedAt !== null ? formatTimestamp(state.stoppedAt) : "unknown";
  return `stopped url=${state.wsUrl} last-pid=${state.pid} stoppedAt=${stoppedAt} liveness=${liveness}`;
};

const parseServeFlags = (argv: string[], defaultCwd: string): ServeFlags => {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let cwd = defaultCwd;
  let token: string | undefined;
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
    throw new Error(`Unknown serve option: ${arg}`);
  }
  return { host, port, token, cwd };
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

const writeDaemonUsage = (output: NodeJS.WritableStream): void => {
  output.write(
    [
      "Usage: scorel daemon serve [--host <h>] [--port <p>] [--token <t>] [--cwd <d>]",
      "       scorel daemon status [--show-token]",
      "       scorel daemon stop",
      "       scorel daemon reset",
    ].join("\n") + "\n",
  );
};
