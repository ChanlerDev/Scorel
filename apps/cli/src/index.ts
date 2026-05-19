#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import {
  createReadonlyTools,
  createWriteTools,
  findLatestSessionId,
  buildSystemPrompt,
  loadScorelConfig,
  resolveScorelModel,
  selectScorelTools,
  ScorelSession,
  SessionStore
} from "@scorel/core";
import type { ScorelEvent, ScorelHistoryItem, ScorelMessage } from "@scorel/core";
import type { ScorelTool, ScorelToolPreset } from "@scorel/core";

export type CliArgs = {
  promptArgs: string[];
  sessionId?: string;
  newSession: boolean;
  resumeLatest: boolean;
  configPath?: string;
  provider?: string;
  model?: string;
  toolsPreset?: ScorelToolPreset;
};

export type PromptCommand =
  | { type: "prompt"; prompt: string }
  | { type: "history" }
  | { type: "rewind"; targetMessageId: string }
  | { type: "fork"; targetMessageId: string }
  | { type: "exit" };

export function parseCliArgs(args = process.argv.slice(2)): CliArgs {
  const promptArgs: string[] = [];
  let sessionId: string | undefined;
  let newSession = false;
  let resumeLatest = false;
  let configPath: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let toolsPreset: ScorelToolPreset | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--session") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--session requires a session id");
      }
      sessionId = value;
      index += 1;
      continue;
    }
    if (arg === "--new") {
      newSession = true;
      continue;
    }
    if (arg === "--resume") {
      resumeLatest = true;
      continue;
    }
    if (arg === "--config") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      configPath = value;
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--provider requires a provider id");
      }
      provider = value;
      index += 1;
      continue;
    }
    if (arg === "--model") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--model requires a model id");
      }
      model = value;
      index += 1;
      continue;
    }
    if (arg === "--tools") {
      const value = args[index + 1];
      if (!isToolPreset(value)) {
        throw new Error("--tools requires one of: none, readonly, coding, all");
      }
      toolsPreset = value;
      index += 1;
      continue;
    }
    promptArgs.push(arg);
  }

  return { promptArgs, sessionId, newSession, resumeLatest, configPath, provider, model, toolsPreset };
}

export async function readPromptFromArgsOrStdin(
  args = process.argv.slice(2),
  readStdin = () => new Promise<string>((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", reject);
  })
): Promise<string> {
  const prompt = args.join(" ").trim();
  if (prompt.length > 0) {
    return prompt;
  }
  return (await readStdin()).trim();
}

export function formatRuntimeEvent(event: ScorelEvent): Array<{ stream: "stdout" | "stderr"; text: string }> {
  if (
    event.type === "message_update" &&
    event.delta &&
    (event.source === "text_delta" || event.source === "text_end" || event.source === "done")
  ) {
    return [{ stream: "stdout", text: event.delta }];
  }
  if (event.type === "tool_execution_start") {
    return [{ stream: "stderr", text: `[tool:start] ${event.toolName} ${event.toolCallId}\n` }];
  }
  if (event.type === "tool_execution_end") {
    const status = event.result.isError ? "error" : "ok";
    return [{ stream: "stderr", text: `[tool:end] ${event.toolName} ${event.toolCallId} ${status}\n` }];
  }
  if (event.type === "runtime_end" && event.error) {
    return [{ stream: "stderr", text: `[runtime:error] ${event.error}\n` }];
  }
  return [];
}

export function createCliTools(preset: ScorelToolPreset = "coding"): ScorelTool[] {
  return selectScorelTools(preset, {
    readonlyTools: createReadonlyTools().filter((tool) => tool.name !== "ls"),
    writeTools: createWriteTools()
  });
}

export function shouldStartInteractiveShell(cliArgs: CliArgs, stdinIsTty = Boolean(process.stdin.isTTY)): boolean {
  return cliArgs.promptArgs.length === 0 && stdinIsTty;
}

export function parsePromptCommand(prompt: string): PromptCommand {
  const trimmed = prompt.trim();
  if (trimmed === "/exit") {
    return { type: "exit" };
  }
  if (trimmed === "/history") {
    return { type: "history" };
  }
  if (trimmed === "/rewind" || trimmed.startsWith("/rewind ")) {
    const targetMessageId = trimmed.slice("/rewind".length).trim();
    if (!targetMessageId) {
      throw new Error("/rewind requires a message id");
    }
    return { type: "rewind", targetMessageId };
  }
  if (trimmed === "/fork" || trimmed.startsWith("/fork ")) {
    const targetMessageId = trimmed.slice("/fork".length).trim();
    if (!targetMessageId) {
      throw new Error("/fork requires a message id");
    }
    return { type: "fork", targetMessageId };
  }
  return { type: "prompt", prompt };
}

export function formatHistory(history: ScorelHistoryItem[]): string {
  return history.map((item) => {
    const marker = item.rewindable ? "*" : "-";
    return `${item.id} ${marker} ${item.message.role} ${summarizeMessage(item.message)}`;
  }).join("\n") + (history.length > 0 ? "\n" : "");
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const cliArgs = parseCliArgs(args);
  const session = await createCliSession(cliArgs);

  process.stderr.write(`[session] ${session.store.sessionId}\n`);

  if (shouldStartInteractiveShell(cliArgs)) {
    const hadRuntimeError = await runInteractiveShell(session);
    if (hadRuntimeError) {
      process.exitCode = 1;
    }
    return;
  }

  const prompt = await readPromptFromArgsOrStdin(cliArgs.promptArgs);
  if (prompt.length === 0) {
    throw new Error("Prompt is required via command arguments or stdin.");
  }

  const hadRuntimeError = await runPromptInput(session, prompt);
  if (hadRuntimeError) {
    process.exitCode = 1;
  }
}

async function createCliSession(cliArgs: CliArgs): Promise<ScorelSession> {
  const config = await loadScorelConfig({
    projectConfigPath: cliArgs.configPath,
    overrides: {
      model: {
        providerId: cliArgs.provider,
        modelId: cliArgs.model
      },
      tools: {
        preset: cliArgs.toolsPreset
      }
    }
  });
  const resolvedModel = resolveScorelModel({ config });
  const systemPrompt = await buildSystemPrompt({ config });
  const sessionId = cliArgs.sessionId ?? (cliArgs.resumeLatest && !cliArgs.newSession ? await findLatestSessionId(config.session.dir) : undefined);
  return ScorelSession.create({
    store: new SessionStore({ sessionsDir: config.session.dir, sessionId }),
    model: resolvedModel.model,
    systemPrompt,
    tools: createCliTools(config.tools.preset),
    streamOptions: { apiKey: resolvedModel.apiKey }
  });
}

async function runPromptInput(session: ScorelSession, prompt: string): Promise<boolean> {
  let runtimeError: string | undefined;
  const command = parsePromptCommand(prompt);
  if (command.type === "exit") {
    return false;
  }
  if (command.type === "history") {
    process.stdout.write(formatHistory(session.history()));
    return false;
  }
  if (command.type === "rewind") {
    await session.rewind(command.targetMessageId);
    process.stdout.write(`[rewind] ${command.targetMessageId} restored. Workspace files were not changed.\n`);
    return false;
  }
  if (command.type === "fork") {
    const forked = await session.fork(command.targetMessageId);
    process.stdout.write(`[fork] ${forked.store.sessionId}\n`);
    return false;
  }

  const unsubscribe = session.runtime.subscribe((event) => {
    if (event.type === "runtime_end" && event.error) {
      runtimeError = event.error;
    }
    for (const formatted of formatRuntimeEvent(event)) {
      const stream = formatted.stream === "stdout" ? process.stdout : process.stderr;
      stream.write(formatted.text);
    }
  });

  try {
    await session.prompt(command.prompt);
  } finally {
    unsubscribe();
    process.stdout.write("\n");
  }
  return runtimeError !== undefined;
}

async function runInteractiveShell(session: ScorelSession): Promise<boolean> {
  const reader = createInterface({ input: processStdin, output: processStdout });
  let hadRuntimeError = false;
  try {
    while (true) {
      const prompt = (await reader.question("scorel> ")).trim();
      if (prompt.length === 0) {
        continue;
      }
      if (parsePromptCommand(prompt).type === "exit") {
        break;
      }
      hadRuntimeError = (await runPromptInput(session, prompt)) || hadRuntimeError;
    }
  } finally {
    reader.close();
  }
  return hadRuntimeError;
}

if (await isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function summarizeMessage(message: ScorelMessage): string {
  if (message.role === "user") {
    return trimSingleLine(contentToText(message.content));
  }
  if (message.role === "assistant" || message.role === "toolResult") {
    const text = message.content
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join(" ");
    return trimSingleLine(text);
  }
  return trimSingleLine(message.kind);
}

function trimSingleLine(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function contentToText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content;
  }
  return content.filter((item) => item.type === "text").map((item) => item.text ?? "").join(" ");
}

function isToolPreset(value: unknown): value is ScorelToolPreset {
  return value === "none" || value === "readonly" || value === "coding" || value === "all";
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) {
    return false;
  }
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href;
}
