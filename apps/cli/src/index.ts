#!/usr/bin/env -S node --import tsx
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";

import { DaemonClient, clientPackageName } from "@scorel/client";
import {
  EmbeddedDaemon,
  createEmbeddedTransport,
  createM1FakeRuntime,
  daemonPackageName,
} from "@scorel/daemon";
import { asClientId, asDeviceId, asSessionId, type ErrorEvent } from "@scorel/protocol";

export const cliAppName = "@scorel/app-cli" as const;
export const cliClientDependency = clientPackageName;
export const cliDaemonDependency = daemonPackageName;

export type CliIo = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
};

type ChatOptions = {
  sessionsDir: string;
  sessionId: ReturnType<typeof asSessionId>;
};

const defaultSessionsDir = (): string => join(homedir(), ".scorel", "sessions");

export const runCli = async (
  argv: string[],
  io: CliIo = { input: process.stdin, output: process.stdout, error: process.stderr },
): Promise<number> => {
  const [command, ...rest] = argv;
  if (command === "chat") {
    if (rest.includes("--help") || rest.includes("-h")) {
      writeUsage(io.output);
      return 0;
    }
    return runChat(parseChatOptions(rest), io);
  }
  writeUsage(io.error);
  return command === "--help" || command === "-h" ? 0 : 1;
};

export const runChat = async (options: ChatOptions, io: CliIo): Promise<number> => {
  const daemon = new EmbeddedDaemon({
    sessionsDir: options.sessionsDir,
    deviceId: asDeviceId("device_local"),
    createRuntime: () => createM1FakeRuntime(),
  });
  const client = new DaemonClient(createEmbeddedTransport(daemon), {
    clientId: asClientId("client_cli"),
  });

  await daemon.start();
  try {
    await client.connect(options.sessionId);
    const resumed = await loadOrCreateSession(client, options);
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

const loadOrCreateSession = async (client: DaemonClient, options: ChatOptions): Promise<boolean> => {
  try {
    await client.loadSession(options.sessionId);
    return true;
  } catch {
    await client.createSession({
      sessionId: options.sessionId,
      meta: { model: "m1-fake-provider" },
    });
    return false;
  }
};

const parseChatOptions = (argv: string[]): ChatOptions => {
  let sessionId = asSessionId("ses_default");
  let sessionsDir = process.env.SCOREL_SESSIONS_DIR ?? defaultSessionsDir();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--session") {
      sessionId = asSessionId(requireValue(argv, index, "--session"));
      index += 1;
      continue;
    }
    if (arg === "--sessions-dir") {
      sessionsDir = requireValue(argv, index, "--sessions-dir");
      index += 1;
      continue;
    }
    throw new Error(`Unknown chat option: ${arg}`);
  }

  return { sessionId, sessionsDir };
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
  output.write("Usage: scorel chat [--session <id>] [--sessions-dir <dir>]\n");
};

const writeEventError = (output: NodeJS.WritableStream, event: ErrorEvent): void => {
  output.write(`scorel event error: ${event.message}\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
