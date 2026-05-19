import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "./llm.js";
import { ScorelRuntime } from "./runtime.js";
import { Type } from "./llm.js";
import type { Api, AssistantMessage, Context, Model, ToolCall } from "./llm.js";
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

function assistantToolCallEventStream(toolCall: ToolCall) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [toolCall],
      api: "openai-responses",
      provider: "openai",
      model: "test-model",
      usage: zeroUsage(),
      stopReason: "toolUse",
      timestamp: Date.now()
    };
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
    stream.push({ type: "done", reason: "toolUse", message });
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

describe("ScorelRuntime", () => {
  it("prompts the configured stream function and emits text deltas", async () => {
    const events: ScorelEvent[] = [];
    const streamSimple = vi.fn(() => assistantEventStream("hello"));
    const runtime = new ScorelRuntime({
      model: testModel(),
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
      model: testModel(),
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
      model: testModel(),
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
      model: testModel(),
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

  it("executes assistant tool calls, appends tool results, and continues to the next assistant turn", async () => {
    const events: ScorelEvent[] = [];
    const contexts: Context[] = [];
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_read_1",
      name: "read",
      arguments: { path: "README.md" }
    };
    const streamSimple = vi.fn((_model, context: Context) => {
      contexts.push(context);
      return contexts.length === 1 ? assistantToolCallEventStream(toolCall) : assistantEventStream("read complete");
    });
    const runtime = new ScorelRuntime({
      model: testModel(),
      tools: [
        {
          name: "read",
          label: "Read",
          description: "Read a file",
          parameters: Type.Object({ path: Type.String() }),
          execute: async ({ args }) => ({
            content: [{ type: "text", text: `file:${args.path}` }],
            details: { path: args.path }
          })
        }
      ],
      streamSimple
    });
    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.prompt("read README");

    expect(streamSimple).toHaveBeenCalledTimes(2);
    expect(contexts[0].tools?.map((tool) => tool.name)).toEqual(["read"]);
    expect(contexts[1].messages.at(-1)).toMatchObject({
      role: "toolResult",
      toolCallId: "call_read_1",
      toolName: "read",
      isError: false
    });
    expect(runtime.state.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(events.map((event) => event.type)).toContain("tool_execution_start");
    expect(events.map((event) => event.type)).toContain("tool_execution_end");
  });

  it("converts tool failures into error tool result messages instead of throwing", async () => {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_bad_1",
      name: "bad",
      arguments: {}
    };
    const streamSimple = vi
      .fn()
      .mockImplementationOnce(() => assistantToolCallEventStream(toolCall))
      .mockImplementationOnce(() => assistantEventStream("handled error"));
    const runtime = new ScorelRuntime({
      model: testModel(),
      tools: [
        {
          name: "bad",
          label: "Bad",
          description: "Always fails",
          parameters: Type.Object({}),
          execute: async () => {
            throw new Error("tool exploded");
          }
        }
      ],
      streamSimple
    });

    await runtime.prompt("call bad");

    expect(runtime.state.status).toBe("idle");
    expect(runtime.state.messages).toContainEqual(
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call_bad_1",
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("tool exploded") }]
      })
    );
  });

  it("continues from the current context without appending a user message", async () => {
    const contexts: Context[] = [];
    const runtime = new ScorelRuntime({
      model: testModel(),
      streamSimple: (_model, context) => {
        contexts.push(context);
        return assistantEventStream("continued");
      }
    });

    await runtime.continue();

    expect(contexts[0].messages).toEqual([]);
    expect(runtime.state.messages).toHaveLength(1);
    expect(runtime.state.messages[0]).toMatchObject({ role: "assistant" });
  });

  it("applies steer messages at the next safe boundary while a run is active", async () => {
    const contexts: Context[] = [];
    const runtime = new ScorelRuntime({
      model: testModel(),
      streamSimple: (_model, context) => {
        contexts.push(context);
        if (contexts.length === 1) {
          queueMicrotask(() => runtime.steer({ role: "user", content: "change direction", timestamp: Date.now() }));
          return assistantEventStream("first");
        }
        return assistantEventStream("steered");
      },
      hooks: {
        shouldStopAfterTurn: ({ turnIndex }) => turnIndex >= 2
      }
    });

    await runtime.prompt("start");

    expect(contexts).toHaveLength(2);
    expect(contexts[1].messages).toContainEqual(expect.objectContaining({ role: "user", content: "change direction" }));
  });

  it("runs followUp messages after the current run naturally stops", async () => {
    const contexts: Context[] = [];
    const runtime = new ScorelRuntime({
      model: testModel(),
      streamSimple: (_model, context) => {
        contexts.push(context);
        if (contexts.length === 1) {
          runtime.followUp({ role: "user", content: "next task", timestamp: Date.now() });
          return assistantEventStream("first");
        }
        return assistantEventStream("second");
      }
    });

    await runtime.prompt("start");

    expect(contexts).toHaveLength(2);
    expect(contexts[1].messages).toContainEqual(expect.objectContaining({ role: "user", content: "next task" }));
  });

  it("aborts the current provider stream and returns to idle with an aborted runtime end event", async () => {
    const events: ScorelEvent[] = [];
    const runtime = new ScorelRuntime({
      model: testModel(),
      streamSimple: (_model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          runtime.abort();
          const message: AssistantMessage = {
            role: "assistant",
            content: [],
            api: "openai-responses",
            provider: "openai",
            model: "test-model",
            usage: zeroUsage(),
            stopReason: options?.signal?.aborted ? "aborted" : "stop",
            errorMessage: options?.signal?.aborted ? "Request aborted" : undefined,
            timestamp: Date.now()
          };
          stream.push({ type: "error", reason: options?.signal?.aborted ? "aborted" : "error", error: message });
        });
        return stream;
      }
    });
    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.prompt("abort");

    expect(runtime.state.status).toBe("idle");
    expect(runtime.state.lastError).toBe("Request aborted");
    expect(events.at(-1)).toMatchObject({ type: "runtime_end", error: "Request aborted" });
  });
});
