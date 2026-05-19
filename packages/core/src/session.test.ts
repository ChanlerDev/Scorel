import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "./llm.js";
import { ScorelSession, SessionStore, replayLogEntries } from "./session.js";
import type { Api, AssistantMessage, Context, Model } from "./llm.js";

function testModel(): Model<Api> {
  return {
    id: "test-model",
    name: "Test Model",
    api: "openai-responses" as const,
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096
  };
}

function assistantEventStream(text: string) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: "openai",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop",
      timestamp: Date.now()
    };
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function assistantMessage(text: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp
  };
}

describe("SessionStore", () => {
  it("appends JSONL entries and reads them back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-session-"));
    try {
      const store = new SessionStore({ sessionsDir: dir, sessionId: "session-a" });
      await store.ensure({ cwd: "/tmp/project", model: { provider: "openai", id: "gpt-4o-mini" } });
      await store.append({
        kind: "message",
        at: 1,
        message: { role: "user", content: "hello", timestamp: 1 }
      });

      await expect(store.readEntries()).resolves.toEqual([
        {
          kind: "message",
          id: expect.any(String),
          at: 1,
          message: { role: "user", content: "hello", timestamp: 1 }
        }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replays message entries into runtime context order", () => {
    expect(
      replayLogEntries([
        { kind: "message", id: "msg-1", at: 1, message: { role: "user", content: "first", timestamp: 1 } },
        { kind: "channel", at: 2, channel: "cli", externalId: "ignored" },
        { kind: "message", id: "msg-2", at: 3, message: { role: "user", content: "second", timestamp: 3 } }
      ])
    ).toEqual({
      history: [
        { id: "msg-1", at: 1, message: { role: "user", content: "first", timestamp: 1 }, rewindable: true },
        { id: "msg-2", at: 3, message: { role: "user", content: "second", timestamp: 3 }, rewindable: true }
      ],
      messages: [
        { role: "user", content: "first", timestamp: 1 },
        { role: "user", content: "second", timestamp: 3 }
      ]
    });
  });

  it("applies rewind markers without deleting later log history", () => {
    const replayed = replayLogEntries([
      { kind: "message", id: "msg-1", at: 1, message: { role: "user", content: "first", timestamp: 1 } },
      { kind: "message", id: "msg-2", at: 2, message: assistantMessage("one", 2) },
      { kind: "message", id: "msg-3", at: 3, message: { role: "user", content: "second", timestamp: 3 } },
      { kind: "message", id: "msg-4", at: 4, message: assistantMessage("two", 4) },
      { kind: "rewind", id: "rewind-1", at: 5, targetMessageId: "msg-1" }
    ]);

    expect(replayed.messages.map((message) => message.role)).toEqual(["user"]);
    expect(replayed.history.map((item) => item.id)).toEqual(["msg-1"]);
  });

  it("rejects rewind markers that target unsafe turn boundaries", () => {
    expect(() =>
      replayLogEntries([
        { kind: "message", id: "msg-1", at: 1, message: { role: "user", content: "first", timestamp: 1 } },
        { kind: "message", id: "msg-2", at: 2, message: assistantMessage("one", 2) },
        { kind: "rewind", id: "rewind-1", at: 3, targetMessageId: "msg-2" }
      ])
    ).toThrow("not a rewindable turn boundary");
  });
});

describe("ScorelSession", () => {
  it("persists user and assistant messages, then restores them for the next run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-session-"));
    try {
      const streamSimple = vi.fn((_model, context: Context) => {
        return assistantEventStream(`seen:${context.messages.map((message) => message.role).join(",")}`);
      });
      const first = await ScorelSession.create({
        store: new SessionStore({ sessionsDir: dir, sessionId: "session-a" }),
        model: testModel(),
        streamSimple
      });

      await first.prompt("remember Scorel");

      const entries = await first.store.readEntries();
      expect(entries.map((entry) => entry.kind)).toEqual(["message", "message"]);
      expect(replayLogEntries(entries).messages.map((message) => message.role)).toEqual(["user", "assistant"]);

      const second = await ScorelSession.create({
        store: new SessionStore({ sessionsDir: dir, sessionId: "session-a" }),
        model: testModel(),
        streamSimple
      });
      await second.prompt("what did I ask?");

      expect(streamSimple).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "remember Scorel" })])
        }),
        expect.anything()
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rewinds by appending a marker and resetting runtime context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-session-"));
    try {
      const streamSimple = vi.fn((_model, context: Context) => assistantEventStream(`seen:${context.messages.length}`));
      const session = await ScorelSession.create({
        store: new SessionStore({ sessionsDir: dir, sessionId: "session-a" }),
        model: testModel(),
        streamSimple
      });

      await session.prompt("first");
      await session.prompt("second");
      const target = session.history().find((item) => item.message.role === "user" && item.message.content === "first");
      expect(target).toBeDefined();

      const replayed = await session.rewind(target!.id);

      expect(replayed.messages).toEqual([{ role: "user", content: "first", timestamp: expect.any(Number) }]);
      expect(session.runtime.state.messages).toEqual(replayed.messages);
      const log = await readFile(join(dir, "session-a", "log.jsonl"), "utf8");
      expect(log).toContain('"kind":"rewind"');
      expect(log).toContain('"second"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forks a session prefix into an independent new session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-session-"));
    try {
      const streamSimple = vi.fn((_model, context: Context) => assistantEventStream(`seen:${context.messages.length}`));
      const session = await ScorelSession.create({
        store: new SessionStore({ sessionsDir: dir, sessionId: "session-a" }),
        model: testModel(),
        streamSimple
      });

      await session.prompt("first");
      await session.prompt("second");
      const target = session.history().find((item) => item.message.role === "user" && item.message.content === "first");
      expect(target).toBeDefined();

      const forked = await session.fork(target!.id, { sessionId: "session-b" });

      expect(forked.store.sessionId).toBe("session-b");
      expect(forked.history().map((item) => item.id)).toEqual([target!.id]);
      await forked.prompt("fork follow-up");

      expect(replayLogEntries(await session.store.readEntries()).messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant"
      ]);
      expect(replayLogEntries(await forked.store.readEntries()).messages.map((message) => message.role)).toEqual([
        "user",
        "user",
        "assistant"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
