import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import type { ScorelMessage } from "@scorel/protocol";

import { createPiAiProvider, resolvePiAiModel } from "./pi-ai.js";
import type { AgentTool } from "../tools/index.js";

describe("createPiAiProvider", () => {
  it("uses pi-ai model metadata and streaming protocol instead of a hand-rolled provider", async () => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "chanleramp",
    });

    try {
      const result = await collectProvider(provider.streamTurn({
        context: [user("read README")],
        systemPrompt: "You are Scorel.",
        tools: [readTool],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(result).toMatchObject({
        role: "assistant",
        content: [{ type: "tool_call", toolCallId: "call_1", toolName: "Read", args: { path: "README.md" } }],
        stopReason: "tool_call",
        meta: {
          api: "openai-completions",
          provider: "scorel-test",
          model: "gpt-5.4-mini",
        },
      });
      expect(server.requests[0]).toMatchObject({
        model: "gpt-5.4-mini",
        stream: true,
        tools: [
          {
            type: "function",
            function: {
              name: "Read",
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });
});

const readTool: AgentTool = {
  name: "Read",
  description: "Read a file",
  execute: async () => ({ content: [] }),
};

const user = (text: string): ScorelMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

const collectProvider = async (stream: AsyncGenerator<unknown, ScorelMessage | void, undefined>) => {
  while (true) {
    const next = await stream.next();
    if (next.done) {
      return next.value;
    }
  }
};

const startOpenAiCompletionsServer = async () => {
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    requests.push(await readJson(request));
    writeSse(response, [
      {
        id: "chatcmpl-scorel-test",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "Read", arguments: "{\"path\":\"README.md\"}" },
                },
              ],
            },
          },
        ],
      },
      {
        id: "chatcmpl-scorel-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
    ]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

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
