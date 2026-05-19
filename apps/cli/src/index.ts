#!/usr/bin/env node

import {
  createReadonlyTools,
  findLatestSessionId,
  loadScorelSettings,
  resolveScorelModel,
  ScorelSession,
  SessionStore
} from "@scorel/core";
import type { ScorelEvent } from "@scorel/core";

export type CliArgs = {
  promptArgs: string[];
  sessionId?: string;
  newSession: boolean;
};

export function parseCliArgs(args = process.argv.slice(2)): CliArgs {
  const promptArgs: string[] = [];
  let sessionId: string | undefined;
  let newSession = false;

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
    promptArgs.push(arg);
  }

  return { promptArgs, sessionId, newSession };
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const cliArgs = parseCliArgs(args);
  const prompt = await readPromptFromArgsOrStdin(cliArgs.promptArgs);
  if (prompt.length === 0) {
    throw new Error("Prompt is required via command arguments or stdin.");
  }

  const settings = await loadScorelSettings();
  const resolvedModel = resolveScorelModel({ env: process.env, settings });
  const sessionId = cliArgs.sessionId ?? (cliArgs.newSession ? undefined : await findLatestSessionId(settings.sessionsDir));
  const session = await ScorelSession.create({
    store: new SessionStore({ sessionsDir: settings.sessionsDir, sessionId }),
    model: resolvedModel.model,
    tools: createReadonlyTools(),
    streamOptions: { apiKey: resolvedModel.apiKey }
  });
  let runtimeError: string | undefined;

  process.stderr.write(`[session] ${session.store.sessionId}\n`);

  session.runtime.subscribe((event) => {
    if (event.type === "runtime_end" && event.error) {
      runtimeError = event.error;
    }
    for (const formatted of formatRuntimeEvent(event)) {
      const stream = formatted.stream === "stdout" ? process.stdout : process.stderr;
      stream.write(formatted.text);
    }
  });

  await session.prompt(prompt);
  process.stdout.write("\n");
  if (runtimeError) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
