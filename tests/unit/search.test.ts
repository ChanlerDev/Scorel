import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase, createSession, insertMessage, searchMessages } from "../../src/main/storage/db.js";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "../../src/shared/types.js";

function userMessage(id: string, content: string, ts: number): UserMessage {
  return {
    role: "user",
    id,
    content,
    ts,
  };
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

function toolResultMessage(id: string, content: string, ts: number): ToolResultMessage {
  return {
    role: "toolResult",
    id,
    toolCallId: `call-${id}`,
    toolName: "bash",
    isError: false,
    content: [{ type: "text", text: content }],
    ts,
  };
}

describe("searchMessages", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("returns highlighted snippets with session context across indexed roles", () => {
    createSession(db, {
      id: "session-a",
      workspaceRoot: "/tmp/a",
      providerId: "provider-1",
      modelId: "model-1",
    });
    createSession(db, {
      id: "session-b",
      workspaceRoot: "/tmp/b",
      providerId: "provider-1",
      modelId: "model-1",
    });

    insertMessage(db, "session-a", 1, userMessage("u1", "hello nebula search", 100));
    insertMessage(db, "session-a", 2, assistantMessage("a1", "nebula result summary", 101));
    insertMessage(db, "session-b", 1, toolResultMessage("t1", "bash output mentions nebula", 102));

    const results = searchMessages(db, "nebula");

    expect(results).toHaveLength(3);
    expect(new Set(results.map((result) => result.messageId))).toEqual(new Set(["u1", "a1", "t1"]));
    expect(results.find((result) => result.messageId === "u1")).toMatchObject({
      sessionId: "session-a",
      sessionTitle: null,
      role: "user",
      seq: 1,
      ts: 100,
    });
    expect(results.every((result) => result.snippet.includes("<mark>nebula</mark>"))).toBe(true);
  });

  it("supports session filtering and trims blank queries", () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    createSession(db, { id: "session-b", workspaceRoot: "/tmp/b" });

    insertMessage(db, "session-a", 1, userMessage("u1", "alpha keyword", 100));
    insertMessage(db, "session-b", 1, userMessage("u2", "alpha elsewhere", 101));

    expect(searchMessages(db, "   ")).toEqual([]);

    const results = searchMessages(db, "alpha", { sessionId: "session-b", limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe("session-b");
    expect(results[0].messageId).toBe("u2");
  });

  it("searches 10k indexed messages quickly on local sqlite", () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });

    for (let index = 1; index <= 10_000; index += 1) {
      const content = index === 9_999
        ? `needle target ${index}`
        : `background message ${index}`;
      insertMessage(db, "session-a", index, userMessage(`u-${index}`, content, index));
    }

    const startedAt = performance.now();
    const results = searchMessages(db, "needle", { limit: 10 });
    const durationMs = performance.now() - startedAt;

    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("u-9999");
    expect(durationMs).toBeLessThan(200);
  });
});
