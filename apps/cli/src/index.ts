#!/usr/bin/env -S node --import tsx
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { join } from "node:path";

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
import { asClientId, asDeviceId, asSeq, asSessionId, type ErrorEvent, type ScorelEvent } from "@scorel/protocol";

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
  sessionId: ReturnType<typeof asSessionId>;
  cwd: string;
  config?: ScorelConfig;
};

const defaultSessionsDir = (): string => scorelSessionsDir(homedir());

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
    return runChat({ ...parseChatOptions(rest), config: runOptions.config, sessionsDir: runOptions.sessionsDir ?? defaultSessionsDir() }, io);
  }
  if (command === "daemon") {
    return runCliDaemon(rest, { stateDir: runOptions.sessionsDir ?? join(homedir(), ".scorel"), output: io.output, error: io.error });
  }
  if (command === "attach") {
    try {
      return runAttach(parseAttachOptions(rest), {
        stateDir: runOptions.sessionsDir ?? join(homedir(), ".scorel"),
        input: io.input,
        output: io.output,
        error: io.error,
      });
    } catch (cause) {
      io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 1;
    }
  }
  writeUsage(io.error);
  return command === "--help" || command === "-h" ? 0 : 1;
};

type AttachOptions = {
  sessionId: ReturnType<typeof asSessionId>;
  remoteUrl?: string;
  token?: string;
};

const runAttach = async (
  options: AttachOptions,
  io: { stateDir: string; input: NodeJS.ReadableStream; output: NodeJS.WritableStream; error: NodeJS.WritableStream },
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
  try {
    await client.connect(options.sessionId);
    const resumed = await loadOrCreateAttachedSession(client, options.sessionId);
    await client.resync(asSeq(0));
    io.output.write(`scorel attach ${resumed ? "resumed" : "created"} session ${options.sessionId}\n`);
    const rl = createInterface({ input: io.input as Readable, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (line.length === 0) {
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
    }
    rl.close();
    client.disconnect();
    return 0;
  } catch (cause) {
    io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
};

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

  return { sessionId, sessionsDir: defaultSessionsDir(), cwd };
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
  output.write("Usage: scorel chat [--session <id>] [--cwd <dir>]\nUsage: scorel attach [--session <id>] [--remote <ws-url> --token <token>]\n");
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
