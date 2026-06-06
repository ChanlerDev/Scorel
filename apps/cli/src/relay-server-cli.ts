import { homedir } from "node:os";
import { join } from "node:path";

import { createConsoleRelayDiagnostics, FileRelayStore, startRelayServer, type RelayServer } from "../../../apps/relay/src/index.js";

export type RelayServerCommandOptions = {
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  serveSignal?: AbortSignal;
};

type RelayServeFlags = {
  host: string;
  port: number;
  dataDir: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export const runCliRelay = async (argv: string[], options: RelayServerCommandOptions): Promise<number> => {
  const [command, ...rest] = argv;
  if (command === "serve") {
    return runRelayServe(rest, options);
  }
  if (command === "--help" || command === "-h") {
    writeRelayUsage(options.output);
    return 0;
  }
  writeRelayUsage(options.error);
  return 1;
};

const runRelayServe = async (argv: string[], options: RelayServerCommandOptions): Promise<number> => {
  let flags: RelayServeFlags;
  try {
    flags = parseRelayServeFlags(argv);
  } catch (cause) {
    options.error.write(`scorel relay serve error: ${(cause as Error).message}\n`);
    return 1;
  }
  let server: RelayServer;
  try {
    server = await startRelayServer({
      host: flags.host,
      port: flags.port,
      store: new FileRelayStore({ dataDir: flags.dataDir }),
      diagnostics: createConsoleRelayDiagnostics(),
    });
  } catch (cause) {
    options.error.write(`scorel relay serve error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
  options.output.write(`scorel relay serving url=${server.url}\n`);
  await waitForStop(options.serveSignal);
  await server.close();
  options.output.write("scorel relay serve stopped\n");
  return 0;
};

const parseRelayServeFlags = (argv: string[]): RelayServeFlags => {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let dataDir = join(homedir(), ".scorel", "relay");
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
    if (arg === "--data-dir") {
      dataDir = requireValue(argv, index, "--data-dir");
      index += 1;
      continue;
    }
    throw new Error(`Unknown relay serve option: ${arg}`);
  }
  return { host, port, dataDir };
};

const waitForStop = (signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal) {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
      return;
    }
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const writeRelayUsage = (output: NodeJS.WritableStream): void => {
  output.write("Usage: scorel relay serve [--host <h>] [--port <p>] [--data-dir <dir>]\n");
};
