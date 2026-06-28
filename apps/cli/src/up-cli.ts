import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  daemonStateLiveness,
  readLocalDaemonState,
  type LocalDaemonState,
} from "@scorel/daemon";

export type UpCommandOptions = {
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  stateDir?: string;
  cwd?: string;
  /**
   * Optional override for tests; takes the same shape as `child_process.spawn`
   * so tests can swap a stubbed lifecycle in without spawning real processes.
   */
  spawn?: (command: string, argv: string[], opts: SpawnOptions) => ChildProcess;
  /**
   * Optional path to the CLI entrypoint (apps/cli/src/index.ts). Defaults to
   * the running script. Tests provide a fake path so spawn args are
   * deterministic.
   */
  cliEntrypoint?: string;
  /**
   * Optional reader so tests can deliver the existing daemon state without
   * touching the filesystem.
   */
  readState?: (stateDir: string) => Promise<LocalDaemonState | null>;
  /**
   * Hook into SIGINT delivery so tests can drive the propagation path
   * deterministically. Returns a teardown that removes the listener.
   */
  attachSigint?: (listener: () => void) => () => void;
  /**
   * Maximum time to wait for the daemon to print its ready line before
   * aborting `up`. Tests shorten this to avoid 10s sleeps.
   */
  daemonReadyTimeoutMs?: number;
};

type UpFlags = {
  daemonPort: number;
  webuiPort: number;
  cwd: string;
};

const DEFAULT_DAEMON_PORT = 7777;
const DEFAULT_WEBUI_PORT = 3000;
const DEFAULT_DAEMON_READY_TIMEOUT_MS = 30_000;

const defaultStateDir = (): string => join(homedir(), ".scorel");

const defaultAttachSigint = (listener: () => void): (() => void) => {
  process.on("SIGINT", listener);
  return () => process.off("SIGINT", listener);
};

export const runCliUp = async (argv: string[], options: UpCommandOptions): Promise<number> => {
  let flags: UpFlags;
  try {
    flags = parseUpFlags(argv, options.cwd ?? process.cwd());
  } catch (cause) {
    options.error.write(`scorel up error: ${(cause as Error).message}\n`);
    return 1;
  }

  const stateDir = options.stateDir ?? defaultStateDir();
  const cliEntrypoint = options.cliEntrypoint ?? fileURLToPath(import.meta.url).replace(/up-cli\.ts$/, "index.ts");
  const spawnFn = options.spawn ?? spawn;
  const readState = options.readState ?? ((dir: string) => readLocalDaemonState({ stateDir: dir }));
  const attachSigint = options.attachSigint ?? defaultAttachSigint;
  const readyTimeout = options.daemonReadyTimeoutMs ?? DEFAULT_DAEMON_READY_TIMEOUT_MS;

  const existingState = await readState(stateDir);
  const existingLiveness = existingState ? daemonStateLiveness(existingState) : null;
  const reuseDaemon = existingState && existingLiveness === "running";

  let daemonChild: ChildProcess | undefined;
  let daemonState: LocalDaemonState | null = existingState;
  if (!reuseDaemon) {
    const daemonArgs = [
      ...nodeEntrypointArgs(cliEntrypoint),
      "daemon",
      "serve",
      "--port",
      String(flags.daemonPort),
      "--cwd",
      flags.cwd,
      "--lifetime",
      "attached",
      "--no-relay",
    ];
    daemonChild = spawnFn(process.execPath, daemonArgs, {
      cwd: dirname(cliEntrypoint),
      env: { ...process.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForDaemonReady(daemonChild, readyTimeout);
    } catch (cause) {
      options.error.write(`scorel up error: ${(cause as Error).message}\n`);
      daemonChild.kill("SIGTERM");
      return 1;
    }
    // Re-read state — serve has now written daemon.json with the bound port,
    // token, and pid we need for the unified header.
    daemonState = await readState(stateDir);
  }

  if (!daemonState) {
    options.error.write("scorel up error: daemon state missing after start\n");
    daemonChild?.kill("SIGTERM");
    return 1;
  }
  if (daemonChild) {
    detachBackgroundDaemon(daemonChild);
  }

  const webuiArgs = [
    ...nodeEntrypointArgs(cliEntrypoint),
    "webui",
    "--port",
    String(flags.webuiPort),
  ];
  const webuiChild = spawnFn(process.execPath, webuiArgs, {
    cwd: dirname(cliEntrypoint),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeWithPrefix(webuiChild, "[webui] ", options.output, options.error);

  options.output.write(`scorel up\n`);
  options.output.write(`  daemon  ${daemonState.wsUrl}  token=${daemonState.token}\n`);
  options.output.write(`  webui   http://127.0.0.1:${flags.webuiPort}\n`);

  let shuttingDown = false;
  const detachSigint = attachSigint(() => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    webuiChild.kill("SIGTERM");
  });

  const webuiExit = once(webuiChild);

  const webuiDeathWatcher = webuiExit.then((code) => {
    if (!shuttingDown) {
      shuttingDown = true;
      options.error.write(`scorel up webui exited code=${code}\n`);
    }
    return code;
  });

  const webuiCode = await webuiDeathWatcher;
  detachSigint();
  options.output.write("scorel up stopped\n");
  return webuiCode === 0 ? 0 : 1;
};

const parseUpFlags = (argv: string[], defaultCwd: string): UpFlags => {
  let daemonPort = DEFAULT_DAEMON_PORT;
  let webuiPort = DEFAULT_WEBUI_PORT;
  let cwd = defaultCwd;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--daemon-port") {
      daemonPort = Number(requireValue(argv, index, "--daemon-port"));
      if (!Number.isInteger(daemonPort) || daemonPort < 0 || daemonPort > 65535) {
        throw new Error("--daemon-port must be an integer from 0 to 65535");
      }
      index += 1;
      continue;
    }
    if (arg === "--webui-port") {
      webuiPort = Number(requireValue(argv, index, "--webui-port"));
      if (!Number.isInteger(webuiPort) || webuiPort < 0 || webuiPort > 65535) {
        throw new Error("--webui-port must be an integer from 0 to 65535");
      }
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      cwd = requireValue(argv, index, "--cwd");
      index += 1;
      continue;
    }
    throw new Error(`Unknown up option: ${arg}`);
  }
  return { daemonPort, webuiPort, cwd };
};

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

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
      const newlineIndex = buffer.lastIndexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      if (buffer.includes("scorel daemon serving url=") || buffer.includes("scorel host serving url=")) {
        if (settled) return;
        settled = true;
        cleanup();
        resolveReady();
      }
      buffer = buffer.slice(newlineIndex + 1);
    };
    // Capture stderr while we wait so a daemon that bails before printing the
    // ready line (e.g. missing SCOREL_API_KEY env, port collision, malformed
    // config) reports the actual cause instead of "exited before ready".
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

const pipeWithPrefix = (
  child: ChildProcess,
  prefix: string,
  output: NodeJS.WritableStream,
  error: NodeJS.WritableStream,
): void => {
  if (child.stdout) {
    pipeStreamLines(child.stdout, prefix, output);
  }
  if (child.stderr) {
    pipeStreamLines(child.stderr, prefix, error);
  }
};

const detachBackgroundDaemon = (child: ChildProcess): void => {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
};

const nodeEntrypointArgs = (entrypoint: string): string[] =>
  entrypoint.endsWith(".ts") ? ["--import", "tsx", entrypoint] : [entrypoint];

const pipeStreamLines = (
  stream: NodeJS.ReadableStream,
  prefix: string,
  destination: NodeJS.WritableStream,
): void => {
  let buffer = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string | Buffer) => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      destination.write(`${prefix} ${line}\n`);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      destination.write(`${prefix} ${buffer}\n`);
      buffer = "";
    }
  });
};

const once = (child: ChildProcess): Promise<number> =>
  new Promise((resolveExit) => {
    child.once("exit", (code) => resolveExit(typeof code === "number" ? code : 0));
  });
