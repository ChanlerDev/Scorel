import { describe, expect, it } from "vitest";

import type { ScorelMessage } from "@scorel/protocol";

import { ScorelRuntime, type RuntimeProvider, type RuntimeProviderTurn, type RuntimeTurnOptions } from "./index.js";
import { defineTool } from "../tools/index.js";

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
