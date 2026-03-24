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

function vector(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

describe("searchMessages", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("returns highlighted snippets with session context across user and assistant messages only", async () => {
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

    const results = await searchMessages(db, "nebula");

    expect(results).toHaveLength(2);
    expect(new Set(results.map((result) => result.messageId))).toEqual(new Set(["u1", "a1"]));
    expect(results.find((result) => result.messageId === "u1")).toMatchObject({
      sessionId: "session-a",
      sessionTitle: null,
      role: "user",
      seq: 1,
      ts: 100,
    });
    expect(results.every((result) => result.snippet.includes("<mark>nebula</mark>"))).toBe(true);
  });

  it("filters tool results from both keyword and semantic retrieval", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    insertMessage(db, "session-a", 1, userMessage("u1", "what is your name", 100));
    insertMessage(db, "session-a", 2, toolResultMessage("t1", "tool schema field name string", 101));

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
      "emb-tool-1",
      "session-a",
      "t1",
      "message",
      "t1",
      0,
      "tool schema field name string",
      5,
      "text-embedding-3-small",
      3,
      vector([1, 0, 0]),
      "hash-tool-1",
      101,
    );

    const results = await searchMessages(
      db,
      "name",
      undefined,
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

    expect(results.map((result) => result.messageId)).toEqual(["u1"]);
  });

  it("supports session filtering and trims blank queries", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    createSession(db, { id: "session-b", workspaceRoot: "/tmp/b" });

    insertMessage(db, "session-a", 1, userMessage("u1", "alpha keyword", 100));
    insertMessage(db, "session-b", 1, userMessage("u2", "alpha elsewhere", 101));

    expect(await searchMessages(db, "   ")).toEqual([]);

    const results = await searchMessages(db, "alpha", { sessionId: "session-b", limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe("session-b");
    expect(results[0].messageId).toBe("u2");
  });

  it("searches 10k indexed messages quickly on local sqlite", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });

    for (let index = 1; index <= 10_000; index += 1) {
      const content = index === 9_999
        ? `needle target ${index}`
        : `background message ${index}`;
      insertMessage(db, "session-a", index, userMessage(`u-${index}`, content, index));
    }

    const startedAt = performance.now();
    const results = await searchMessages(db, "needle", { limit: 10 });
    const durationMs = performance.now() - startedAt;

    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("u-9999");
    expect(durationMs).toBeLessThan(200);
  });

  it("returns semantic-only matches when FTS misses", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    insertMessage(db, "session-a", 1, userMessage("u1", "login handler with JWT tokens", 100));

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
      ) VALUES (
        @id,
        @sessionId,
        @sourceId,
        @sourceType,
        @targetMessageId,
        @chunkIndex,
        @chunkText,
        @tokenCount,
        @model,
        @dimensions,
        @vector,
        @hash,
        0,
        @createdAt
      )`,
    ).run({
      id: "emb-1",
      sessionId: "session-a",
      sourceId: "u1",
      sourceType: "message",
      targetMessageId: "u1",
      chunkIndex: 0,
      chunkText: "login handler with JWT tokens",
      tokenCount: 5,
      model: "text-embedding-3-small",
      dimensions: 3,
      vector: vector([1, 0, 0]),
      hash: "hash-1",
      createdAt: 100,
    });

    const results = await searchMessages(
      db,
      "authentication flow",
      undefined,
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

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      messageId: "u1",
      snippet: "login handler with JWT tokens",
      snippetSource: "semantic",
      signals: ["semantic"],
    });
    expect(results[0].similarityScore).toBeGreaterThan(0.99);
  });

  it("uses reciprocal rank fusion to merge keyword and semantic signals", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });

    insertMessage(db, "session-a", 1, userMessage("u1", "nebula authentication flow", 100));
    insertMessage(db, "session-a", 2, userMessage("u2", "login handler with JWT tokens", 101));

    const insertEmbedding = db.prepare(
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
    );

    insertEmbedding.run(
      "emb-1",
      "session-a",
      "u1",
      "message",
      "u1",
      0,
      "nebula authentication flow",
      3,
      "text-embedding-3-small",
      3,
      vector([1, 0, 0]),
      "hash-1",
      100,
    );
    insertEmbedding.run(
      "emb-2",
      "session-a",
      "u2",
      "message",
      "u2",
      0,
      "login handler with JWT tokens",
      5,
      "text-embedding-3-small",
      3,
      vector([0.9, 0.1, 0]),
      "hash-2",
      101,
    );

    const results = await searchMessages(
      db,
      "nebula",
      { limit: 10 },
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

    expect(results).toHaveLength(2);
    expect(results[0]?.messageId).toBe("u1");
    expect(results[0]?.signals).toEqual(["keyword", "semantic"]);
    expect(results[0]?.snippetSource).toBe("fts");
    expect(results[1]).toMatchObject({
      messageId: "u2",
      snippetSource: "semantic",
      signals: ["semantic"],
    });
    expect(results[0]!.rrfScore).toBeGreaterThan(results[1]!.rrfScore);
  });

  it("falls back to FTS results when query embedding fails", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    insertMessage(db, "session-a", 1, userMessage("u1", "nebula keyword only", 100));

    const results = await searchMessages(
      db,
      "nebula",
      undefined,
      {
        embedding: {
          enabled: true,
          providerId: null,
          model: "text-embedding-3-small",
          dimensions: 3,
          minScore: 0.7,
        },
        embedQuery: async () => {
          throw new Error("provider unavailable");
        },
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      messageId: "u1",
      snippetSource: "fts",
      signals: ["keyword"],
    });
  });

  it("applies session filters to semantic retrieval", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    createSession(db, { id: "session-b", workspaceRoot: "/tmp/b" });
    insertMessage(db, "session-a", 1, userMessage("u1", "JWT tokens", 100));
    insertMessage(db, "session-b", 1, userMessage("u2", "JWT tokens", 101));

    const insertEmbedding = db.prepare(
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
    );

    insertEmbedding.run("emb-1", "session-a", "u1", "message", "u1", 0, "JWT tokens", 2, "text-embedding-3-small", 3, vector([1, 0, 0]), "hash-1", 100);
    insertEmbedding.run("emb-2", "session-b", "u2", "message", "u2", 0, "JWT tokens", 2, "text-embedding-3-small", 3, vector([1, 0, 0]), "hash-2", 101);

    const results = await searchMessages(
      db,
      "authentication",
      { sessionId: "session-b" },
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

    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("session-b");
    expect(results[0]?.messageId).toBe("u2");
  });

  it("respects the configured semantic min score", async () => {
    createSession(db, { id: "session-a", workspaceRoot: "/tmp/a" });
    insertMessage(db, "session-a", 1, userMessage("u1", "identity prompt", 100));

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
      "emb-low-score",
      "session-a",
      "u1",
      "message",
      "u1",
      0,
      "identity prompt",
      2,
      "text-embedding-3-small",
      2,
      vector([0.65, Math.sqrt(1 - 0.65 ** 2)]),
      "hash-low-score",
      100,
    );

    const results = await searchMessages(
      db,
      "name",
      undefined,
      {
        embedding: {
          enabled: true,
          providerId: null,
          model: "text-embedding-3-small",
          dimensions: 2,
          minScore: 0.7,
        },
        embedQuery: async () => new Float32Array([1, 0]),
        minScore: 0.7,
      },
    );

    expect(results).toEqual([]);
  });
});
