#!/usr/bin/env node

import { createOpenAICompatibleChatModel, getModel } from "@scorel/core/llm";
import { createReadonlyTools, ScorelRuntime } from "@scorel/core";
import type { ScorelEvent } from "@scorel/core";

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
  const prompt = await readPromptFromArgsOrStdin(args);
  if (prompt.length === 0) {
    throw new Error("Prompt is required via command arguments or stdin.");
  }

  const provider = process.env.SCOREL_PROVIDER ?? "openai";
  const modelId = process.env.SCOREL_MODEL ?? "gpt-4o-mini";
  const baseUrl = process.env.SCOREL_BASE_URL;
  const apiKey = process.env.SCOREL_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = baseUrl
    ? createOpenAICompatibleChatModel({ id: modelId, baseUrl, provider })
    : getModel(provider as "openai", modelId as never);
  const runtime = new ScorelRuntime({ model, tools: createReadonlyTools(), streamOptions: { apiKey } });
  let runtimeError: string | undefined;

  runtime.subscribe((event) => {
    if (event.type === "runtime_end" && event.error) {
      runtimeError = event.error;
    }
    for (const formatted of formatRuntimeEvent(event)) {
      const stream = formatted.stream === "stdout" ? process.stdout : process.stderr;
      stream.write(formatted.text);
    }
  });

  await runtime.prompt(prompt);
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
