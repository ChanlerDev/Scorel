import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { cliAppName, cliClientDependency, cliDaemonDependency, runCli } from "@scorel/app-cli";
import type { ScorelConfig } from "@scorel/daemon";

describe("@scorel/app-cli", () => {
  it("is an entrypoint shell over client/daemon", () => {
    expect(cliAppName).toBe("@scorel/app-cli");
    expect(cliClientDependency).toBe("@scorel/client");
    expect(cliDaemonDependency).toBe("@scorel/daemon");
  });

  it("routes daemon status to local daemon discovery", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-state-"));
    const result = await runCliWithInput(["daemon", "status"], "", testConfig("http://127.0.0.1:1"), sessionsDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("scorel daemon stopped");
  });

  it("runs a real OpenAI-compatible coding loop through CLI, tools, persistence, and resume", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-workspace-"));
    const sessionId = "ses_cli_real_coding_alpha";
    await mkdir(join(workspaceDir, "src"));
    await writeFile(join(workspaceDir, "src", "value.txt"), "status=wrong\n");
    const server = await startChatServer([
      {
        content: null,
        tool_calls: [
          toolCall("call_todo_1", "TodoWrite", {
            todos: [
              { content: "Find value", status: "in_progress", activeForm: "Finding value" },
              { content: "Fix value", status: "pending", activeForm: "Fixing value" },
              { content: "Verify", status: "pending", activeForm: "Verifying" },
            ],
          }),
        ],
      },
      {
        content: null,
        tool_calls: [toolCall("call_grep", "Grep", { pattern: "wrong", glob: "src/*.txt", output_mode: "content" })],
      },
      {
        content: null,
        tool_calls: [toolCall("call_read", "Read", { file_path: "src/value.txt" })],
      },
      {
        content: null,
        tool_calls: [toolCall("call_edit", "Edit", { file_path: "src/value.txt", old_string: "wrong", new_string: "right" })],
      },
      {
        content: null,
        tool_calls: [toolCall("call_bash", "Bash", { command: "grep right src/value.txt" })],
      },
      {
        content: null,
        tool_calls: [
          toolCall("call_todo_2", "TodoWrite", {
            todos: [
              { content: "Find value", status: "completed", activeForm: "Finding value" },
              { content: "Fix value", status: "completed", activeForm: "Fixing value" },
              { content: "Verify", status: "completed", activeForm: "Verifying" },
            ],
          }),
        ],
      },
      { content: "Done. status is fixed.", tool_calls: [] },
      { content: "Resume sees completed work.", tool_calls: [] },
    ]);

    try {
      const config = testConfig(server.baseURL);
      const first = await runCliWithInput(
        ["chat", "--session", sessionId, "--cwd", workspaceDir],
        "Fix the failing status value and verify it.\n.exit\n",
        config,
        sessionsDir,
      );

      expect(first.code).toBe(0);
      expect(first.stderr).toContain("created session ses_cli_real_coding_alpha");
      for (const toolName of ["TodoWrite", "Grep", "Read", "Edit", "Bash"]) {
        expect(first.stdout).toContain(`[tool:${toolName}]`);
      }
      expect(first.stdout).toContain("All items are completed");
      expect(first.stdout).toContain("status=right");
      expect(first.stdout).toContain("Done. status is fixed.");

      const second = await runCliWithInput(
        ["chat", "--session", sessionId, "--cwd", workspaceDir],
        "Continue from previous context.\n.exit\n",
        config,
        sessionsDir,
      );
      expect(second.code).toBe(0);
      expect(second.stderr).toContain("resumed session ses_cli_real_coding_alpha");
      expect(second.stdout).toContain("Resume sees completed work.");

      const jsonl = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf8");
      const lines = jsonl.trim().split("\n").map((line) => JSON.parse(line));
      const toolNames = lines
        .filter((line) => line.type === "tool_result")
        .map((line) => line.message.content[0].toolName);
      expect(toolNames).toEqual(["TodoWrite", "Grep", "Read", "Edit", "Bash", "TodoWrite"]);
      expect(server.requests.length).toBe(8);
      const firstRequest = server.requests[0] as { tools?: Array<{ function?: { name?: string; parameters?: unknown } }> };
      const readTool = firstRequest.tools?.find((tool) => tool.function?.name === "Read");
      expect(server.requests[0]).toMatchObject({
        model: "gpt-5.4-mini",
        tools: expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "TodoWrite" }) })]),
      });
      expect(readTool).toMatchObject({
        function: {
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              file_path: expect.any(Object),
              full: expect.any(Object),
            }),
          }),
        },
      });
      expect(server.requests.at(-1)).toMatchObject({
        messages: expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
      });
    } finally {
      await server.close();
    }
  });
});

const runCliWithInput = async (
  argv: string[],
  input: string,
  config: ScorelConfig,
  sessionsDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  const code = await runCli(argv, {
    input: Readable.from([input]),
    output: stdout,
    error: stderr,
  }, { config, sessionsDir });
  return { code, stdout: stdout.toString(), stderr: stderr.toString() };
};

class StringWritable extends Writable {
  #chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#chunks.push(chunk.toString());
    callback();
  }

  override toString(): string {
    return this.#chunks.join("");
  }
}

type AssistantResponse = {
  content: string | null;
  tool_calls: Array<ReturnType<typeof toolCall>>;
};

const startChatServer = async (responses: AssistantResponse[]) => {
  const requests: unknown[] = [];
  let index = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    requests.push(await readJson(request));
    const item = responses[index++];
    if (!item) {
      response.writeHead(500).end(JSON.stringify({ error: { message: "unexpected request" } }));
      return;
    }
    writeSse(response, toSseChunks(item));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: {
    name,
    arguments: JSON.stringify(args),
  },
});

const testConfig = (baseURL: string): ScorelConfig => ({
  model: {
    type: "custom",
    api: "openai-completions",
    provider: "scorel-test",
    id: "gpt-5.4-mini",
    baseUrl: baseURL,
    apiKey: "chanleramp",
    contextWindow: 400000,
    maxTokens: 128000,
    reasoning: true,
  },
});

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const writeSse = (response: ServerResponse, chunks: unknown[]): void => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
};

const toSseChunks = (item: AssistantResponse): unknown[] => {
  const chunks = [];
  if (item.content) {
    chunks.push({
      id: "chatcmpl-scorel-cli-test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: item.content } }],
    });
  }
  for (const [index, toolCall] of item.tool_calls.entries()) {
    chunks.push({
      id: "chatcmpl-scorel-cli-test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index, ...toolCall }] } }],
    });
  }
  chunks.push({
    id: "chatcmpl-scorel-cli-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: item.tool_calls.length > 0 ? "tool_calls" : "stop" }],
  });
  return chunks;
};
