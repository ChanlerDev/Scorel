import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import { mapToolKind, runCliAcp, toolTitle } from "./acp-cli.js";
import type { ScorelConfig } from "@scorel/daemon";

const minimalConfig = (baseUrl: string): ScorelConfig => ({
  providers: {
    test: { type: "custom", api: "openai-completions", provider: "scorel-test", baseUrl, apiKey: "chanleramp" },
  },
  providerModels: {
    main: { provider: "test", id: "gpt-5.4-mini", displayName: "GPT 5.4 Mini", contextWindow: 400000, maxTokens: 128000, reasoning: true },
  },
  models: { main: { model: "main", displayName: "GPT 5.4 Mini" } },
  modelProfile: { roles: { primary: "main", standard: "main", auxiliary: "main" } },
  memory: { enabled: false, daily: false, sessionMemory: false, autoDream: false, promoteRoot: false, dreamIdleMinutes: 60, autoCompactThreshold: 0.8 },
  runtime: { tokenSavingRtk: false },
  taskBudget: { maxTokens: 0, maxCostUsd: 0, maxWallClockMinutes: 0, repeatedCommandThreshold: 3, staleProgressMinutes: 10 },
  extensions: {},
  mcpServers: {},
});

/**
 * Read NDJSON lines from a PassThrough and resolve with the next JSON-RPC
 * response matching the given id. All other lines (notifications, unrelated
 * responses) are pushed onto the `side` array so the caller can assert on
 * session/update sequencing.
 */
const nextResponse = (stream: PassThrough, id: number | string, side: unknown[] = []): Promise<any> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ACP response")), 30_000);
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length === 0) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.id === id && (parsed.result !== undefined || parsed.error !== undefined)) {
          clearTimeout(timer);
          stream.off("data", onData);
          resolve(parsed);
        } else {
          side.push(parsed);
        }
      }
    };
    stream.on("data", onData);
  });

const writeRequest = (stdin: PassThrough, id: number, method: string, params: unknown): void => {
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
};

describe("mapToolKind", () => {
  it("maps every Scorel built-in tool to the correct ACP ToolKind", () => {
    expect(mapToolKind("Read")).toBe("read");
    expect(mapToolKind("Glob")).toBe("search");
    expect(mapToolKind("Grep")).toBe("search");
    expect(mapToolKind("Write")).toBe("edit");
    expect(mapToolKind("Edit")).toBe("edit");
    expect(mapToolKind("snip")).toBe("edit");
    expect(mapToolKind("AppendDaily")).toBe("edit");
    expect(mapToolKind("Bash")).toBe("execute");
    expect(mapToolKind("BashStop")).toBe("execute");
    expect(mapToolKind("TodoWrite")).toBe("think");
    expect(mapToolKind("Task")).toBe("think");
    expect(mapToolKind("TaskStop")).toBe("think");
    expect(mapToolKind("Skill")).toBe("read");
    expect(mapToolKind("SendChannelMessage")).toBe("other");
  });

  it("falls back to 'other' for unknown tools", () => {
    expect(mapToolKind("SomeFutureTool")).toBe("other");
  });
});

describe("toolTitle", () => {
  it("builds a human-readable title from tool name and args", () => {
    expect(toolTitle("Read", { file_path: "src/index.ts" })).toBe("Read src/index.ts");
    expect(toolTitle("Bash", { command: "npm test" })).toBe("Run: npm test");
    expect(toolTitle("Edit", { file_path: "src/foo.ts" })).toBe("Edit src/foo.ts");
    expect(toolTitle("TodoWrite", {})).toBe("Update task list");
    expect(toolTitle("Task", { description: "Fix the bug" })).toBe("Fix the bug");
    expect(toolTitle("Skill", { name: "web-browser" })).toBe("Load skill: web-browser");
  });

  it("falls back to tool name when args are missing", () => {
    expect(toolTitle("Read", undefined)).toBe("Read file");
    expect(toolTitle("Bash", undefined)).toBe("Run: command");
    expect(toolTitle("UnknownTool", { x: 1 })).toBe("UnknownTool");
  });
});

describe("scorel acp", () => {
  it("handles initialize, session/new, session/list, session/load, and session/close over JSON-RPC stdio", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-acp-"));
    const sessionsDir = join(stateDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const cwd = await mkdtemp(join(tmpdir(), "scorel-acp-cwd-"));

    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const runPromise = runCliAcp({
      stateDir,
      sessionsDir,
      cwd,
      config: minimalConfig("http://127.0.0.1:9"),
      input: stdin,
      output: stdout,
    });

    // initialize — must advertise loadSession, list, resume, and close capabilities
    writeRequest(stdin, 1, "initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    const init = await nextResponse(stdout, 1);
    expect(init.error).toBeUndefined();
    expect(init.result.protocolVersion).toBe(1);
    expect(init.result.agentCapabilities?.loadSession).toBe(true);
    expect(init.result.agentCapabilities?.sessionCapabilities?.list).toEqual({});
    expect(init.result.agentCapabilities?.sessionCapabilities?.resume).toEqual({});
    expect(init.result.agentCapabilities?.sessionCapabilities?.close).toEqual({});

    // session/new
    writeRequest(stdin, 2, "session/new", { cwd, mcpServers: [] });
    const created = await nextResponse(stdout, 2);
    expect(created.error).toBeUndefined();
    expect(typeof created.result.sessionId).toBe("string");
    expect(created.result.sessionId.startsWith("ses_acp_")).toBe(true);
    const sessionId = created.result.sessionId;

    // session/list — should show the session we just created
    writeRequest(stdin, 3, "session/list", { cwd });
    const listed = await nextResponse(stdout, 3);
    expect(listed.error).toBeUndefined();
    expect(Array.isArray(listed.result.sessions)).toBe(true);
    expect(listed.result.sessions.some((s: { sessionId: string }) => s.sessionId === sessionId)).toBe(true);

    // session/load — should replay history (empty for a fresh session) and return {}
    writeRequest(stdin, 4, "session/load", { sessionId, cwd, mcpServers: [] });
    const loaded = await nextResponse(stdout, 4);
    expect(loaded.error).toBeUndefined();
    expect(loaded.result).toEqual({});

    // session/close
    writeRequest(stdin, 5, "session/close", { sessionId });
    const closed = await nextResponse(stdout, 5);
    expect(closed.error).toBeUndefined();
    expect(closed.result).toEqual({});

    // Tear down
    stdin.end();
    const code = await runPromise;
    expect(code).toBe(0);
  });

  it("runs a real session/prompt with tool calls, streaming, and correct event ordering", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-acp-prompt-"));
    const sessionsDir = join(stateDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const cwd = await mkdtemp(join(tmpdir(), "scorel-acp-prompt-cwd-"));
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "value.txt"), "status=wrong\n");

    // Fake OpenAI server: turn 1 calls Read, turn 2 emits final text.
    // The title generation request (no tools) is handled separately.
    const server = await startFakeOpenAIServer(
      [
        {
          content: null,
          tool_calls: [fakeToolCall("call_read", "Read", { file_path: "src/value.txt" })],
        },
        { content: "The value is wrong. I fixed it.", tool_calls: [] },
      ],
      { titleResponse: { content: "Test Session", tool_calls: [] } },
    );

    try {
      const stdin = new PassThrough();
      const stdout = new PassThrough();

      const runPromise = runCliAcp({
        stateDir,
        sessionsDir,
        cwd,
        config: minimalConfig(server.baseURL),
        input: stdin,
        output: stdout,
      });

      // initialize
      writeRequest(stdin, 1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
      const init = await nextResponse(stdout, 1);
      expect(init.error).toBeUndefined();

      // session/new
      writeRequest(stdin, 2, "session/new", { cwd, mcpServers: [] });
      const created = await nextResponse(stdout, 2);
      expect(created.error).toBeUndefined();
      const sessionId = created.result.sessionId;

      // session/prompt — collect all side notifications
      const side: any[] = [];
      writeRequest(stdin, 3, "session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Read src/value.txt and tell me what you see." }],
      });
      const promptResp = await nextResponse(stdout, 3, side);
      expect(promptResp.error).toBeUndefined();
      expect(promptResp.result.stopReason).toBe("end_turn");

      // Assert event ordering from the side notifications.
      const updates = side
        .filter((msg) => msg.method === "session/update")
        .map((msg) => msg.params.update);

      // Must contain: agent_message_chunk(s), tool_call, tool_call_update,
      // then more agent_message_chunk(s) for the final text.
      const updateTypes = updates.map((u) => u.sessionUpdate);

      // Tool call with correct kind/title/status.
      const toolCall = updates.find((u) => u.sessionUpdate === "tool_call");
      expect(toolCall).toBeDefined();
      expect(toolCall.toolCallId).toBe("call_read");
      expect(toolCall.kind).toBe("read");
      expect(toolCall.title).toBe("Read src/value.txt");
      expect(toolCall.status).toBe("in_progress");

      // Tool result with readable content (not raw JSON wrapper).
      const toolUpdate = updates.find((u) => u.sessionUpdate === "tool_call_update");
      expect(toolUpdate).toBeDefined();
      expect(toolUpdate.toolCallId).toBe("call_read");
      expect(toolUpdate.status).toBe("completed");
      expect(Array.isArray(toolUpdate.content)).toBe(true);
      expect(toolUpdate.content.length).toBeGreaterThan(0);
      // Content must be ACP ToolCallContent with type "content" wrapping a text block.
      const textContent = toolUpdate.content[0];
      expect(textContent.type).toBe("content");
      expect(textContent.content.type).toBe("text");
      expect(textContent.content.text).toContain("status=wrong");
      // Must NOT be the raw {content, details} wrapper.
      expect(textContent.content.text).not.toContain('{"content"');

      // Final text message chunk after the tool call.
      const messageChunks = updates.filter((u) => u.sessionUpdate === "agent_message_chunk");
      expect(messageChunks.length).toBeGreaterThanOrEqual(1);
      const lastChunk = messageChunks[messageChunks.length - 1];
      expect(lastChunk.content.type).toBe("text");
      expect(lastChunk.content.text).toContain("The value is wrong");

      // The tool_call must come before the final agent_message_chunk.
      const toolCallIdx = updateTypes.indexOf("tool_call");
      const lastMsgIdx = updateTypes.lastIndexOf("agent_message_chunk");
      expect(toolCallIdx).toBeLessThan(lastMsgIdx);

      // The tool_call_update must come after the tool_call.
      const toolUpdateIdx = updateTypes.indexOf("tool_call_update");
      expect(toolUpdateIdx).toBeGreaterThan(toolCallIdx);

      // session/close
      writeRequest(stdin, 4, "session/close", { sessionId });
      const closed = await nextResponse(stdout, 4);
      expect(closed.error).toBeUndefined();

      stdin.end();
      const code = await runPromise;
      expect(code).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("returns a JSON-RPC error when the provider fails during session/prompt", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-acp-err-"));
    const sessionsDir = join(stateDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const cwd = await mkdtemp(join(tmpdir(), "scorel-acp-err-cwd-"));

    // Server that returns a premature stream end (finish_reason without content).
    const server = await startErrorOpenAIServer("error", {
      titleResponse: { content: "Error Session", tool_calls: [] },
    });

    try {
      const stdin = new PassThrough();
      const stdout = new PassThrough();

      const runPromise = runCliAcp({
        stateDir,
        sessionsDir,
        cwd,
        config: minimalConfig(server.baseURL),
        input: stdin,
        output: stdout,
      });

      writeRequest(stdin, 1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
      await nextResponse(stdout, 1);

      writeRequest(stdin, 2, "session/new", { cwd, mcpServers: [] });
      const created = await nextResponse(stdout, 2);
      const sessionId = created.result.sessionId;

      const side: any[] = [];
      writeRequest(stdin, 3, "session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Hello" }],
      });
      const promptResp = await nextResponse(stdout, 3, side);

      // Per ACP spec, prompt-processing errors must be JSON-RPC errors,
      // not agent_message_chunks with error text.
      expect(promptResp.error).toBeDefined();

      // No agent_message_chunk should contain "[error]" text.
      const errorChunks = side
        .filter((msg) => msg.method === "session/update")
        .map((msg) => msg.params.update)
        .filter((u) => u.sessionUpdate === "agent_message_chunk")
        .filter((u) => typeof u.content?.text === "string" && u.content.text.includes("[error]"));
      expect(errorChunks).toHaveLength(0);

      stdin.end();
      await runPromise;
    } finally {
      await server.close();
    }
  });

  it("replays tool results with readable content on session/load", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-acp-replay-"));
    const sessionsDir = join(stateDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const cwd = await mkdtemp(join(tmpdir(), "scorel-acp-replay-cwd-"));
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "value.txt"), "status=wrong\n");

    const server = await startFakeOpenAIServer(
      [
        {
          content: null,
          tool_calls: [fakeToolCall("call_read", "Read", { file_path: "src/value.txt" })],
        },
        { content: "Done.", tool_calls: [] },
      ],
      { titleResponse: { content: "Replay Session", tool_calls: [] } },
    );

    try {
      const stdin = new PassThrough();
      const stdout = new PassThrough();

      const runPromise = runCliAcp({
        stateDir,
        sessionsDir,
        cwd,
        config: minimalConfig(server.baseURL),
        input: stdin,
        output: stdout,
      });

      // initialize + session/new + prompt (to create history)
      writeRequest(stdin, 1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
      await nextResponse(stdout, 1);
      writeRequest(stdin, 2, "session/new", { cwd, mcpServers: [] });
      const created = await nextResponse(stdout, 2);
      const sessionId = created.result.sessionId;
      writeRequest(stdin, 3, "session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Read src/value.txt" }],
      });
      await nextResponse(stdout, 3);

      // Now load the session — replay should emit tool_call + tool_call_update
      // with readable content (not raw JSON wrapper).
      const replaySide: any[] = [];
      writeRequest(stdin, 4, "session/load", { sessionId, cwd, mcpServers: [] });
      const loaded = await nextResponse(stdout, 4, replaySide);
      expect(loaded.error).toBeUndefined();

      const replayUpdates = replaySide
        .filter((msg) => msg.method === "session/update")
        .map((msg) => msg.params.update);

      const replayToolUpdate = replayUpdates.find((u) => u.sessionUpdate === "tool_call_update");
      expect(replayToolUpdate).toBeDefined();
      expect(replayToolUpdate.status).toBe("completed");
      expect(Array.isArray(replayToolUpdate.content)).toBe(true);
      expect(replayToolUpdate.content[0].type).toBe("content");
      expect(replayToolUpdate.content[0].content.type).toBe("text");
      expect(replayToolUpdate.content[0].content.text).toContain("status=wrong");

      stdin.end();
      await runPromise;
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible server helpers (adapted from apps/cli/src/index.test.ts)
// ---------------------------------------------------------------------------

type FakeResponse = {
  content: string | null;
  tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

const fakeToolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

/** Start an HTTP server with a handler, returning its base URL and a close function. */
const startHttpServer = async (
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<{ baseURL: string; close: () => Promise<void> }> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
};

/** Returns true for title-generation requests (no tools array in the body). */
const isTitleRequest = (body: unknown): boolean => !Array.isArray((body as { tools?: unknown }).tools);

const startFakeOpenAIServer = async (
  responses: FakeResponse[],
  options: { titleResponse?: FakeResponse } = {},
): Promise<{ baseURL: string; close: () => Promise<void> }> => {
  let index = 0;
  return startHttpServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonBody(request);
    const item = isTitleRequest(body) && options.titleResponse ? options.titleResponse : responses[index++];
    if (!item) {
      response.writeHead(500).end(JSON.stringify({ error: { message: "unexpected request" } }));
      return;
    }
    writeSseResponse(response, toSseChunksBody(item));
  });
};

const startErrorOpenAIServer = async (
  finishReason: string,
  options: { titleResponse?: FakeResponse } = {},
): Promise<{ baseURL: string; close: () => Promise<void> }> =>
  startHttpServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonBody(request);
    if (isTitleRequest(body) && options.titleResponse) {
      writeSseResponse(response, toSseChunksBody(options.titleResponse));
      return;
    }
    writeSseResponse(response, [
      {
        id: "chatcmpl-scorel-acp-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      },
    ]);
  });

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const writeSseResponse = (response: ServerResponse, chunks: unknown[]): void => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
};

const toSseChunksBody = (item: FakeResponse): unknown[] => {
  const chunks: unknown[] = [];
  if (item.content) {
    chunks.push({
      id: "chatcmpl-scorel-acp-test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: item.content } }],
    });
  }
  for (const [index, tc] of item.tool_calls.entries()) {
    chunks.push({
      id: "chatcmpl-scorel-acp-test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index, ...tc }] } }],
    });
  }
  chunks.push({
    id: "chatcmpl-scorel-acp-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: item.tool_calls.length > 0 ? "tool_calls" : "stop" }],
    ...(item.usage ? { usage: item.usage } : {}),
  });
  return chunks;
};
