import { mkdtemp, rm } from "node:fs/promises";
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
        { kind: "message", at: 1, message: { role: "user", content: "first", timestamp: 1 } },
        { kind: "channel", at: 2, channel: "cli", externalId: "ignored" },
        { kind: "message", at: 3, message: { role: "user", content: "second", timestamp: 3 } }
      ])
    ).toEqual({
      messages: [
        { role: "user", content: "first", timestamp: 1 },
        { role: "user", content: "second", timestamp: 3 }
      ]
    });
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
});
