import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { initDatabase, createSession, insertMessage, getSessionDetail, searchMessages } from "../../src/main/storage/db.js";
import { getCompaction, insertCompaction } from "../../src/main/storage/compactions.js";
import {
  applyMicroCompact,
  applyBoundaryResume,
  executeManualCompact,
  saveCompactTranscript,
  serializeForCompact,
} from "../../src/main/core/compact.js";
import type {
  AssistantMessage,
  ProviderConfig,
  ScorelMessage,
  ToolResultMessage,
  UserMessage,
} from "../../src/shared/types.js";
import type { AssistantMessageEvent } from "../../src/shared/events.js";
import type { ProviderAdapter, ProviderRequestOptions } from "../../src/main/provider/types.js";

function userMessage(id: string, content: string, ts: number): UserMessage {
  return { role: "user", id, content, ts };
}

function assistantMessage(id: string, text: string, ts: number): AssistantMessage {
  return {
    role: "assistant",
    id,
    api: "openai-chat-completions",
    providerId: "provider-1",
    modelId: "model-1",
    content: [{ type: "text", text }],
    stopReason: "stop",
    ts,
  };
}

function assistantToolCallMessage(id: string, ts: number): AssistantMessage {
  return {
    role: "assistant",
    id,
    api: "openai-chat-completions",
    providerId: "provider-1",
    modelId: "model-1",
    content: [
      { type: "text", text: "Let me inspect that." },
      { type: "toolCall", id: `${id}-call`, name: "read_file", arguments: { path: "src/main.ts" } },
    ],
    stopReason: "toolUse",
    ts,
  };
}

function toolResultMessage(id: string, toolName: string, content: string, ts: number): ToolResultMessage {
  return {
    role: "toolResult",
    id,
    toolCallId: `${id}-call`,
    toolName,
    isError: false,
    content: [{ type: "text", text: content }],
    details: { rawOutput: content, truncated: false },
    ts,
  };
}

const TEST_PROVIDER_CONFIG: ProviderConfig = {
  id: "provider-1",
  displayName: "Test Provider",
  api: "openai-chat-completions",
  baseUrl: "https://api.test.com",
  auth: { type: "bearer", keyRef: "test-key" },
  models: [{ id: "model-1", displayName: "Test Model" }],
};

describe("compact", () => {
  let db: Database.Database;
  let transcriptDir: string;

  beforeEach(() => {
    db = initDatabase(":memory:");
    transcriptDir = path.join(os.tmpdir(), `scorel-compact-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(transcriptDir, { recursive: true, force: true });
  });

  it("applyMicroCompact replaces only old tool results beyond the keepRecent turn window", () => {
    const messages: ScorelMessage[] = [];

    for (let turn = 1; turn <= 5; turn += 1) {
      messages.push(userMessage(`u${turn}`, `prompt ${turn}`, turn * 10));
      messages.push(assistantToolCallMessage(`a${turn}`, turn * 10 + 1));
      messages.push(toolResultMessage(`t${turn}`, "read_file", `tool output ${turn}`, turn * 10 + 2));
    }

    const compacted = applyMicroCompact(messages, 3);
    const toolResults = compacted.filter(
      (message): message is ToolResultMessage => message.role === "toolResult",
    );

    expect(toolResults[0].content[0].text).toBe("[Previous: used read_file]");
    expect(toolResults[0].details).toBeUndefined();
    expect(toolResults[1].content[0].text).toBe("tool output 2");
    expect(toolResults[2].content[0].text).toBe("tool output 3");
    expect(toolResults[3].content[0].text).toBe("tool output 4");
    expect(toolResults[4].content[0].text).toBe("tool output 5");
  });

  it("applyMicroCompact replaces the first 6 tool results after 10 turns", () => {
    const messages: ScorelMessage[] = [];

    for (let turn = 1; turn <= 10; turn += 1) {
      messages.push(userMessage(`u${turn}`, `prompt ${turn}`, turn * 10));
      messages.push(assistantToolCallMessage(`a${turn}`, turn * 10 + 1));
      messages.push(toolResultMessage(`t${turn}`, "read_file", `tool output ${turn}`, turn * 10 + 2));
    }

    const toolResults = applyMicroCompact(messages, 3).filter(
      (message): message is ToolResultMessage => message.role === "toolResult",
    );

    expect(toolResults.slice(0, 6).every((message) => message.content[0].text === "[Previous: used read_file]")).toBe(true);
    expect(toolResults.slice(6).map((message) => message.content[0].text)).toEqual([
      "tool output 7",
      "tool output 8",
      "tool output 9",
      "tool output 10",
    ]);
  });

  it("applyBoundaryResume prepends the summary and keeps only post-boundary messages", () => {
    const messages: ScorelMessage[] = [
      userMessage("u2", "new prompt", 102),
      assistantMessage("a2", "new answer", 103),
    ];

    const resumed = applyBoundaryResume(messages, {
      id: "cmp-1",
      sessionId: "session-1",
      boundaryMessageId: "a1",
      summaryText: "Summary of previous work",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: null,
      createdAt: 99,
    });

    expect(resumed).toHaveLength(3);
    expect(resumed[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Summary of previous work"),
    });
    expect(resumed[1].id).toBe("u2");
    expect(resumed[2].id).toBe("a2");
  });

  it("serializeForCompact renders roles, tool calls, and truncates tool results", () => {
    const serialized = serializeForCompact([
      userMessage("u1", "Fix the bug", 100),
      assistantToolCallMessage("a1", 101),
      toolResultMessage("t1", "read_file", "x".repeat(700), 102),
    ]);

    expect(serialized).toContain("[User]\nFix the bug");
    expect(serialized).toContain("[Assistant]\nLet me inspect that.");
    expect(serialized).toContain("[Tool Call: read_file]");
    expect(serialized).toContain('"path": "src/main.ts"');
    expect(serialized).toContain("[Tool Result: read_file]");
    expect(serialized).toContain("... (truncated)");
  });

  it("executeManualCompact stores summary, activates compaction, and writes transcript", async () => {
    createSession(db, {
      id: "session-1",
      workspaceRoot: "/tmp/workspace",
      providerId: "provider-1",
      modelId: "model-1",
    });

    const messages: ScorelMessage[] = [
      userMessage("u1", "Please inspect the auth bug", 100),
      assistantToolCallMessage("a1", 101),
      toolResultMessage("t1", "read_file", "export function login() {}", 102),
      assistantMessage("a2", "The issue is in the expiry check.", 103),
    ];

    messages.forEach((message, index) => {
      insertMessage(db, "session-1", index + 1, message);
    });

    const adapter: ProviderAdapter = {
      api: "openai-chat-completions",
      async stream(
        _config: ProviderConfig,
        _apiKey: string,
        opts: ProviderRequestOptions,
        onEvent: (event: AssistantMessageEvent) => void,
      ): Promise<AssistantMessage> {
        expect(opts.messages).toHaveLength(1);
        expect(opts.messages[0]).toMatchObject({
          role: "user",
          content: expect.stringContaining("Please inspect the auth bug"),
        });

        const summary = assistantMessage(
          "summary-1",
          "Decision: fix expiry check. Files: src/auth.ts. Status: pending implementation.",
          200,
        );

        onEvent({ type: "start", partial: summary });
        onEvent({ type: "done", reason: "stop", message: summary });
        return summary;
      },
    };

    const result = await executeManualCompact({
      sessionId: "session-1",
      messages,
      transcriptMessages: messages.map((message, index) => ({
        seq: index + 1,
        message,
      })),
      db,
      adapter,
      providerConfig: TEST_PROVIDER_CONFIG,
      apiKey: "sk-test",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptDir,
    });

    const compaction = getCompaction(db, result.compactionId);
    const session = getSessionDetail(db, "session-1");

    expect(result.summaryText).toContain("fix expiry check");
    expect(result.boundaryMessageId).toBe("a2");
    expect(compaction).not.toBeNull();
    expect(compaction?.summaryText).toContain("fix expiry check");
    expect(session?.activeCompactId).toBeNull();
    expect(result.transcriptPath).toBeDefined();
    expect(existsSync(result.transcriptPath!)).toBe(true);

    const transcript = readFileSync(result.transcriptPath!, "utf8");
    expect(transcript).toContain('"type":"compaction"');
    expect(transcript).toContain('"message":{"role":"assistant"');
  });

  it("saveCompactTranscript preserves sparse DB seq values", async () => {
    const transcriptPath = await saveCompactTranscript(
      transcriptDir,
      "session-gap",
      "cmp-gap",
      [
        { seq: 10, message: userMessage("u1", "old request", 100) },
        { seq: 20, message: assistantMessage("a1", "boundary answer", 101) },
        { seq: 30, message: userMessage("u2", "new request", 102) },
      ],
    );

    const lines = readFileSync(transcriptPath, "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { seq: number; message: { role: string } });

    expect(lines.map((line) => line.seq)).toEqual([10, 20, 30]);
    expect(lines.map((line) => line.message.role)).toEqual(["user", "assistant", "user"]);
  });

  it("search finds content because compaction never deletes messages", async () => {
    createSession(db, {
      id: "session-search",
      workspaceRoot: "/tmp/workspace",
      providerId: "provider-1",
      modelId: "model-1",
    });

    insertMessage(db, "session-search", 1, userMessage("u1", "nebula issue before compact", 100));
    insertMessage(db, "session-search", 2, assistantMessage("a1", "Investigated nebula issue", 101));

    const results = await searchMessages(db, "nebula", { sessionId: "session-search" });

    expect(results).toHaveLength(2);
    expect(new Set(results.map((result) => result.messageId))).toEqual(new Set(["u1", "a1"]));
  });

  it("semantic search can surface compaction summaries and navigate to the boundary message", async () => {
    createSession(db, {
      id: "session-search",
      workspaceRoot: "/tmp/workspace",
      providerId: "provider-1",
      modelId: "model-1",
    });

    insertMessage(db, "session-search", 1, userMessage("u1", "kickoff discussion", 100));
    insertMessage(db, "session-search", 2, assistantMessage("a1", "implemented login handler", 101));

    insertCompaction(db, {
      id: "compact-1",
      sessionId: "session-search",
      boundaryMessageId: "a1",
      summaryText: "Authentication flow uses JWT tokens and a login handler.",
      providerId: "provider-1",
      modelId: "model-1",
      transcriptPath: null,
      createdAt: 102,
    });

    db.prepare(
      `INSERT INTO embeddings (
        id,
        session_id,
        source_id,
        source_type,
        target_message_id,
        chunk_index,
        chunk_text,
        token_count,
        model,
        dimensions,
        vector,
        hash,
        tombstone,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      "emb-compact-1",
      "session-search",
      "compact-1",
      "compaction",
      "a1",
      0,
      "Authentication flow uses JWT tokens and a login handler.",
      9,
      "text-embedding-3-small",
      3,
      Buffer.from(new Float32Array([1, 0, 0]).buffer),
      "hash-compact-1",
      102,
    );

    const results = await searchMessages(
      db,
      "authentication",
      { sessionId: "session-search" },
      {
        embedding: {
          enabled: true,
          providerId: null,
          model: "text-embedding-3-small",
          dimensions: 3,
          minScore: 0.7,
        },
        embedQuery: async () => new Float32Array([1, 0, 0]),
      },
    );

    expect(results[0]).toMatchObject({
      messageId: "a1",
      snippet: "Authentication flow uses JWT tokens and a login handler.",
      snippetSource: "semantic",
      signals: ["semantic"],
    });
  });
});
