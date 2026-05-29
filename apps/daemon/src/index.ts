import {
  EmbeddedDaemon,
  createRealRuntime,
  daemonPackageName,
  loadScorelConfig,
  scorelSessionsDir,
  startEmbeddedDaemonWebSocketServer,
} from "@scorel/daemon";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalDaemonState, readLocalDaemonState, removeLocalDaemonState } from "@scorel/daemon";
import { asDeviceId } from "@scorel/protocol";

export const daemonAppName = "@scorel/app-daemon" as const;
export const daemonAppDependency = daemonPackageName;

export type DaemonCommandIo = {
  output: { write(chunk: string): void };
  error: { write(chunk: string): void };
};

export type DaemonCommandOptions = DaemonCommandIo & {
  stateDir?: string;
  cwd?: string;
  sessionsDir?: string;
  serveSignal?: AbortSignal;
};

const defaultStateDir = (): string => join(homedir(), ".scorel");

export const runDaemonCommand = async (
  argv: string[],
  options: DaemonCommandOptions = { output: process.stdout, error: process.stderr },
): Promise<number> => {
  const [command, ...rest] = argv;
  if (command === "start") {
    const stateDir = options.stateDir ?? defaultStateDir();
    const existing = await readLocalDaemonState({ stateDir });
    if (existing) {
      options.error.write(`scorel daemon already running pid=${existing.pid}\n`);
      return 1;
    }
    const state = await createLocalDaemonState({
      stateDir,
      pid: process.pid,
      socketPath: join(stateDir, "daemon.sock"),
      token: `local-${Date.now()}`,
      startedAt: Date.now(),
    });
    options.output.write(`scorel daemon started pid=${state.pid} socket=${state.socketPath}\n`);
    return 0;
  }
  if (command === "status") {
    const state = await readLocalDaemonState({ stateDir: options.stateDir ?? defaultStateDir() });
    if (!state) {
      options.error.write("scorel daemon stopped\n");
      return 1;
    }
    options.output.write(`scorel daemon running pid=${state.pid} socket=${state.socketPath}\n`);
    return 0;
  }
  if (command === "stop") {
    const stateDir = options.stateDir ?? defaultStateDir();
    const state = await readLocalDaemonState({ stateDir });
    if (!state) {
      options.error.write("scorel daemon stopped\n");
      return 1;
    }
    await removeLocalDaemonState({ stateDir });
    options.output.write("scorel daemon stopped\n");
    return 0;
  }
  if (command === "serve") {
    return runServeCommand(rest, options);
  }
  options.error.write("Usage: scorel-daemon start|status|stop|serve --host <host> --port <port> --token <token> [--cwd <dir>]\n");
  return command === "--help" || command === "-h" ? 0 : 1;
};

type ServeOptions = {
  host: string;
  port: number;
  token: string;
  cwd: string;
};

const runServeCommand = async (argv: string[], options: DaemonCommandOptions): Promise<number> => {
  let serve: ServeOptions;
  try {
    serve = parseServeOptions(argv, options.cwd ?? process.cwd());
  } catch (cause) {
    options.error.write(`scorel daemon serve error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
  const config = await loadScorelConfig({ cwd: serve.cwd });
  const daemon = new EmbeddedDaemon({
    sessionsDir: options.sessionsDir ?? scorelSessionsDir(homedir()),
    deviceId: asDeviceId("device_remote"),
    deviceDisplayName: "Remote daemon",
    projectSlug: projectSlugFromCwd(serve.cwd),
    createRuntime: () => createRealRuntime({ cwd: serve.cwd, config }),
  });
  await daemon.start();
  const server = await startEmbeddedDaemonWebSocketServer({
    daemon,
    host: serve.host,
    port: serve.port,
    token: serve.token,
  });
  options.output.write(`scorel daemon serving url=${server.url}\n`);

  try {
    await waitForServeStop(options.serveSignal);
  } finally {
    await server.close();
    await daemon.shutdown();
  }
  options.output.write("scorel daemon serve stopped\n");
  return 0;
};

const parseServeOptions = (argv: string[], defaultCwd: string): ServeOptions => {
  let host = "127.0.0.1";
  let port = 0;
  let token = "";
  let cwd = defaultCwd;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      host = requireValue(argv, index, "--host");
      index += 1;
      continue;
    }
    if (arg === "--port") {
      port = Number(requireValue(argv, index, "--port"));
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
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535");
  }
  if (!token) {
    throw new Error("--token requires a value");
  }
  return { host, port, token, cwd };
};

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const projectSlugFromCwd = (cwd: string): string => basename(resolve(cwd)) || "project";

const waitForServeStop = (signal: AbortSignal | undefined): Promise<void> => {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (signal) {
      signal.addEventListener("abort", () => resolve(), { once: true });
      return;
    }
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDaemonCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
