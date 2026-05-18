import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "./llm.js";
import { ScorelRuntime } from "./runtime.js";
import type { AssistantMessage } from "./llm.js";
import type { ScorelEvent } from "./types.js";

function assistantEventStream(text: string) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const partial: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: "openai-responses",
      provider: "openai",
      model: "test-model",
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: Date.now()
    };
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: {
        ...partial,
        content: [{ type: "text", text }]
      }
    });
    const message: AssistantMessage = {
      ...partial,
      content: [{ type: "text", text }],
      timestamp: Date.now()
    };
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function assistantEventStreamWithoutDelta(text: string) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const partial: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: "openai-responses",
      provider: "openai",
      model: "test-model",
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: Date.now()
    };
    const message: AssistantMessage = {
      ...partial,
      content: [{ type: "text", text }],
      timestamp: Date.now()
    };
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function assistantEventStreamDoneOnly(text: string) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: "openai",
      model: "test-model",
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: Date.now()
    };
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

describe("ScorelRuntime", () => {
  it("prompts the configured stream function and emits text deltas", async () => {
    const events: ScorelEvent[] = [];
    const streamSimple = vi.fn(() => assistantEventStream("hello"));
    const runtime = new ScorelRuntime({
      model: {
        id: "test-model",
        name: "Test Model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      },
      streamSimple
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.prompt("say hello");

    expect(streamSimple).toHaveBeenCalledOnce();
    expect(runtime.state.status).toBe("idle");
    expect(events.map((event) => event.type)).toEqual([
      "runtime_start",
      "turn_start",
      "message_start",
      "message_update",
      "message_end",
      "turn_end",
      "runtime_end"
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_update",
        delta: "hello"
      })
    );
  });

  it("awaits async subscribers before waitForIdle resolves", async () => {
    const order: string[] = [];
    const runtime = new ScorelRuntime({
      model: {
        id: "test-model",
        name: "Test Model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      },
      streamSimple: () => assistantEventStream("ok")
    });

    runtime.subscribe(async (event) => {
      if (event.type === "message_end") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("subscriber");
      }
    });

    await runtime.prompt("barrier");
    await runtime.waitForIdle();
    order.push("after-idle");

    expect(order).toEqual(["subscriber", "after-idle"]);
  });

  it("emits text_end content when the provider does not stream deltas", async () => {
    const deltas: string[] = [];
    const runtime = new ScorelRuntime({
      model: {
        id: "test-model",
        name: "Test Model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      },
      streamSimple: () => assistantEventStreamWithoutDelta("fallback")
    });

    runtime.subscribe((event) => {
      if (event.type === "message_update" && event.delta) {
        deltas.push(event.delta);
      }
    });

    await runtime.prompt("fallback");

    expect(deltas).toEqual(["fallback"]);
  });

  it("emits done message text when the provider only returns the final message", async () => {
    const deltas: string[] = [];
    const runtime = new ScorelRuntime({
      model: {
        id: "test-model",
        name: "Test Model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      },
      streamSimple: () => assistantEventStreamDoneOnly("done text")
    });

    runtime.subscribe((event) => {
      if (event.type === "message_update" && event.delta) {
        deltas.push(event.delta);
      }
    });

    await runtime.prompt("done only");

    expect(deltas).toEqual(["done text"]);
  });
});
