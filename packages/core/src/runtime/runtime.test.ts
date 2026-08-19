import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { ScorelMessage } from "@scorel/protocol";

import { ScorelRuntime, type RuntimeProvider, type RuntimeProviderTurn, type RuntimeTurnOptions } from "./index.js";
import type { ProviderRetryConfig } from "../provider/retry.js";
import { defineTool } from "../tools/index.js";

/** Retry config with negligible delays for fast test execution. */
const fastRetryConfig: ProviderRetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1,
  maxDelayMs: 5,
  jitterFactor: 0,
};

const userMessage = (text: string): ScorelMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

const assistantMessage = (text: string): ScorelMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

const collect = async (
  runtime: ScorelRuntime,
  context: ScorelMessage[] = [userMessage("hi")],
  options: RuntimeTurnOptions = {},
) => {
  const events = [];
  for await (const event of runtime.executeTurn(context, "system", options)) {
    events.push(event);
  }
  return events;
};

describe("ScorelRuntime", () => {
  it("streams ordered raw events for a successful assistant turn", async () => {
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        yield { type: "text_delta", delta: "hel" };
        yield { type: "text_delta", delta: "lo" };
        return assistantMessage("hello");
      },
    };
    const runtime = new ScorelRuntime({ provider });

    await expect(collect(runtime)).resolves.toEqual([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "text_delta", delta: "hel" },
      { type: "text_delta", delta: "lo" },
      { type: "message_end", message: assistantMessage("hello") },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
    expect(runtime.running).toBe(false);
  });

  it("streams thinking deltas and synthesizes ordered thinking/text content", async () => {
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        yield { type: "thinking_delta", delta: "inspect" };
        yield { type: "thinking_delta", delta: " files" };
        yield { type: "text_delta", delta: "done" };
      },
    };
    const runtime = new ScorelRuntime({ provider });

    await expect(collect(runtime)).resolves.toEqual([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "thinking_delta", delta: "inspect" },
      { type: "thinking_delta", delta: " files" },
      { type: "text_delta", delta: "done" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", text: "inspect files" },
            { type: "text", text: "done" },
          ],
          stopReason: "end_turn",
          meta: undefined,
        },
      },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("emits partial message and error events when provider fails after text", async () => {
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        yield { type: "text_delta", delta: "partial" };
        throw new Error("provider down");
      },
    };
    const runtime = new ScorelRuntime({ provider });

    await expect(collect(runtime)).resolves.toEqual([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "text_delta", delta: "partial" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
          stopReason: "error",
          meta: { partial: true },
        },
      },
      { type: "error", error: expect.any(Error) },
      { type: "turn_end", stopReason: "error" },
    ]);
  });

  it("retries one premature stream end before visible text", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        if (attempts === 1) {
          yield { type: "thinking_delta", delta: "incomplete" };
          throw new Error("Stream ended without finish_reason");
        }
        yield { type: "thinking_delta", delta: "complete" };
        yield { type: "text_delta", delta: "done" };
        return assistantMessage("done");
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(2);
    expect(events).not.toContainEqual({ type: "turn_end", stopReason: "error" });
    expect(events.at(-2)).toEqual({ type: "message_end", message: assistantMessage("done") });
  });

  it("retries a premature stream error result returned by an OpenAI-compatible provider", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        if (attempts === 1) {
          yield { type: "thinking_delta", delta: "incomplete" };
          return {
            role: "assistant",
            content: [{ type: "thinking", text: "incomplete" }],
            stopReason: "error",
            meta: {
              api: "openai-completions",
              errorMessage: "Stream ended without finish_reason",
            },
          } satisfies ScorelMessage;
        }
        return assistantMessage("recovered");
      },
    };

    const events = await collect(new ScorelRuntime({ provider, retryConfig: fastRetryConfig }));

    expect(attempts).toBe(2);
    expect(events.at(-2)).toEqual({ type: "message_end", message: assistantMessage("recovered") });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("does not retry a premature stream end after visible text", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        yield { type: "text_delta", delta: "partial" };
        throw new Error("Stream ended without finish_reason");
      },
    };

    const events = await collect(new ScorelRuntime({ provider, retryConfig: fastRetryConfig }));

    expect(attempts).toBe(1);
    expect(events).toContainEqual({ type: "turn_end", stopReason: "error" });
  });

  it("retries a 429 error before visible text and succeeds on retry", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("429 Too Many Requests");
        }
        yield { type: "text_delta", delta: "hello" };
        return assistantMessage("hello");
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(2);
    expect(events.at(-2)).toEqual({ type: "message_end", message: assistantMessage("hello") });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("retries a transient network error before visible text", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error("fetch failed: ECONNRESET");
        }
        yield { type: "text_delta", delta: "recovered" };
        return assistantMessage("recovered");
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(3);
    expect(events.at(-2)).toEqual({ type: "message_end", message: assistantMessage("recovered") });
  });

  it("does not retry a non-retryable error (401 Unauthorized)", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        const error = new Error("401 Unauthorized");
        (error as { status?: number }).status = 401;
        throw error;
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(1);
    expect(events).toContainEqual({ type: "turn_end", stopReason: "error" });
    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("does not retry a content_filter error assistant message", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        return {
          role: "assistant",
          content: [],
          stopReason: "error",
          meta: { errorMessage: "content_filter" },
        } satisfies ScorelMessage;
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(1);
    expect(events).toContainEqual({ type: "turn_end", stopReason: "error" });
  });

  it("exhausts max retry attempts and surfaces a final error", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        throw new Error("503 Service unavailable");
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    // 1 initial + 5 retries = 6 total attempts
    expect(attempts).toBe(6);
    expect(events).toContainEqual({ type: "turn_end", stopReason: "error" });
  });

  it("does not retry after visible text even for retryable errors", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        yield { type: "text_delta", delta: "partial response" };
        throw new Error("503 Service unavailable");
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(1);
    expect(events).toContainEqual({ type: "turn_end", stopReason: "error" });
    // Partial text should be preserved
    expect(events).toContainEqual({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial response" }],
        stopReason: "error",
        meta: { partial: true },
      },
    });
  });

  it("aborts during backoff sleep without retrying further", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        throw new Error("503 Service unavailable");
      },
    };
    const runtime = new ScorelRuntime({
      provider,
      retryConfig: {
        maxAttempts: 10,
        baseDelayMs: 10_000,
        maxDelayMs: 10_000,
        jitterFactor: 0,
      },
    });

    // Abort after 50ms (during the first backoff sleep).
    setTimeout(() => runtime.cancel(), 50);

    const events = [];
    for await (const event of runtime.executeTurn([userMessage("hi")], undefined, {})) {
      events.push(event);
    }

    expect(attempts).toBe(1);
    expect(events).toContainEqual({ type: "turn_end", stopReason: "cancelled" });
  });

  it("does not retry abort errors", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        const error = new Error("Request was aborted");
        error.name = "AbortError";
        throw error;
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(1);
    // Abort errors produce cancelled stop reason, not error
    expect(events).toContainEqual({ type: "turn_end", stopReason: "cancelled" });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("retries an error assistant message with a retryable error before visible text", async () => {
    let attempts = 0;
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        attempts += 1;
        if (attempts === 1) {
          return {
            role: "assistant",
            content: [],
            stopReason: "error",
            meta: { errorMessage: "overloaded" },
          } satisfies ScorelMessage;
        }
        return assistantMessage("recovered");
      },
    };
    const runtime = new ScorelRuntime({ provider, retryConfig: fastRetryConfig });

    const events = await collect(runtime);

    expect(attempts).toBe(2);
    expect(events.at(-2)).toEqual({ type: "message_end", message: assistantMessage("recovered") });
  });

  it("cancels streaming without emitting an empty persistent message", async () => {
    let turn!: RuntimeProviderTurn;
    const provider: RuntimeProvider = {
      streamTurn: async function* (input) {
        turn = input;
        yield { type: "text_delta", delta: "first" };
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (!input.signal.aborted) {
          yield { type: "text_delta", delta: " second" };
        }
      },
    };
    const runtime = new ScorelRuntime({ provider });
    const events = [];

    for await (const event of runtime.executeTurn([userMessage("hi")], undefined, {})) {
      events.push(event);
      if (event.type === "text_delta") {
        runtime.cancel();
      }
    }

    expect(turn.signal.aborted).toBe(true);
    expect(events).toEqual([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "text_delta", delta: "first" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "first" }],
          stopReason: "cancelled",
          meta: { partial: true },
        },
      },
      { type: "turn_end", stopReason: "cancelled" },
    ]);
  });

  it("ends an empty provider turn without emitting an empty assistant message", async () => {
    const provider: RuntimeProvider = {
      streamTurn: async function* () {
        return undefined;
      },
    };
    const runtime = new ScorelRuntime({ provider });

    await expect(collect(runtime)).resolves.toEqual([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("executes registered tools serially and continues the provider loop", async () => {
    const providerCalls: ScorelMessage[][] = [];
    const provider: RuntimeProvider = {
      streamTurn: async function* ({ context }) {
        providerCalls.push(context);
        if (providerCalls.length === 1) {
          return {
            role: "assistant",
            content: [
              { type: "text", text: "reading" },
              { type: "tool_call", toolCallId: "call_1", toolName: "echo", args: { text: "ok" } },
            ],
            stopReason: "tool_call",
          };
        }
        return assistantMessage("done");
      },
    };
    const runtime = new ScorelRuntime({ provider });
    runtime.registerTool(
      defineTool({
        name: "echo",
        description: "Echo text",
        parameters: Type.Object({
          text: Type.String(),
        }),
        execute: async (_toolCallId, args) => ({
          content: [{ type: "text", text: String((args as { text: string }).text) }],
        }),
      }),
    );

    const events = await collect(runtime);

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "message_start",
      "message_end",
      "tool_execution_start",
      "tool_execution_end",
      "message_start",
      "message_end",
      "turn_end",
    ]);
    expect(providerCalls[1]?.at(-1)).toEqual({
      role: "tool_result",
      content: [
        {
          type: "tool_result",
          toolCallId: "call_1",
          toolName: "echo",
          result: { content: [{ type: "text", text: "ok" }] },
          isError: false,
        },
      ],
    });
  });

  it("does not pass tool execution details into the next provider turn", async () => {
    const providerCalls: ScorelMessage[][] = [];
    const provider: RuntimeProvider = {
      streamTurn: async function* ({ context }) {
        providerCalls.push(context);
        if (providerCalls.length === 1) {
          return {
            role: "assistant",
            content: [{ type: "tool_call", toolCallId: "call_1", toolName: "echo", args: { text: "ok" } }],
            stopReason: "tool_call",
          };
        }
        return assistantMessage("done");
      },
    };
    const runtime = new ScorelRuntime({ provider });
    runtime.registerTool(
      defineTool({
        name: "echo",
        description: "Echo text",
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: "text", text: "ok" }],
          details: { command: "rtk echo ok", rtk: { applied: true } },
        }),
      }),
    );

    const events = await collect(runtime);

    const execution = events.find((event) => event.type === "tool_execution_end");
    expect(execution).toMatchObject({
      type: "tool_execution_end",
      result: {
        details: { command: "rtk echo ok", rtk: { applied: true } },
      },
    });
    expect(providerCalls[1]?.at(-1)).toEqual({
      role: "tool_result",
      content: [
        {
          type: "tool_result",
          toolCallId: "call_1",
          toolName: "echo",
          result: { content: [{ type: "text", text: "ok" }] },
          isError: false,
        },
      ],
    });
  });

  it("can refresh context after tool execution before the next provider turn", async () => {
    const providerCalls: ScorelMessage[][] = [];
    const provider: RuntimeProvider = {
      streamTurn: async function* ({ context }) {
        providerCalls.push(context);
        if (providerCalls.length === 1) {
          return {
            role: "assistant",
            content: [{ type: "tool_call", toolCallId: "call_1", toolName: "echo", args: { text: "ok" } }],
            stopReason: "tool_call",
          };
        }
        return assistantMessage("done");
      },
    };
    const runtime = new ScorelRuntime({ provider });
    runtime.registerTool(
      defineTool({
        name: "echo",
        description: "Echo text",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
      }),
    );

    await collect(runtime, [userMessage("hi")], {
      refreshContext: (context) => [
        ...context,
        {
          role: "user",
          content: [{ type: "text", text: "<system-reminder>\nsteer\n</system-reminder>" }],
        },
      ],
    });

    expect(providerCalls[1]?.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "<system-reminder>\nsteer\n</system-reminder>" }],
    });
  });
});
