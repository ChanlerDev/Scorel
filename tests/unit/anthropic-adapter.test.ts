import { describe, it, expect } from "vitest";
import { anthropicAdapter } from "../../src/main/provider/anthropic-adapter.js";
import type { ProviderConfig } from "../../src/shared/types.js";
import type { AssistantMessageEvent } from "../../src/shared/events.js";

function makeConfig(): ProviderConfig {
  return {
    id: "test-anthropic",
    displayName: "Test Anthropic",
    api: "anthropic-messages",
    baseUrl: "http://localhost:9999",
    auth: { type: "x-api-key", keyRef: "test-key" },
    models: [{ id: "claude-3-opus", displayName: "Claude 3 Opus" }],
  };
}

function sseLines(events: Array<{ event: string; data: unknown }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n`).join("\n") + "\n";
}

function mockResponse(status: number, body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

// We need to intercept fetch to return our mock
function withMockFetch(body: string, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => mockResponse(200, body);
  return fn().finally(() => { globalThis.fetch = original; });
}

function withMockFetchError(status: number, body: string, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status });
  return fn().finally(() => { globalThis.fetch = original; });
}

describe("anthropicAdapter", () => {
  it("streams a text-only turn (Case E)", async () => {
    const sseBody = sseLines([
      { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ]);

    await withMockFetch(sseBody, async () => {
      const events: AssistantMessageEvent["type"][] = [];
      const msg = await anthropicAdapter.stream(
        makeConfig(),
        "test-key",
        { systemPrompt: "You are helpful", messages: [], providerId: "test-anthropic", modelId: "claude-3-opus" },
        (e) => events.push(e.type),
      );

      expect(msg.content).toHaveLength(1);
      expect(msg.content[0]).toEqual({ type: "text", text: "Hello world" });
      expect(msg.stopReason).toBe("stop");
      expect(msg.api).toBe("anthropic-messages");
      expect(msg.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
      expect(events).toContain("start");
      expect(events).toContain("text_delta");
      expect(events).toContain("done");
    });
  });

  it("streams a tool use turn", async () => {
    const sseBody = sseLines([
      { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 20, output_tokens: 0 } } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check." } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_123", name: "bash" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"com' } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'mand":"ls"}' } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 15 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ]);

    await withMockFetch(sseBody, async () => {
      const msg = await anthropicAdapter.stream(
        makeConfig(),
        "test-key",
        { systemPrompt: "", messages: [], providerId: "test-anthropic", modelId: "claude-3-opus" },
        () => {},
      );

      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({ type: "text", text: "Let me check." });
      expect(msg.content[1]).toEqual({ type: "toolCall", id: "toolu_123", name: "bash", arguments: { command: "ls" } });
      expect(msg.stopReason).toBe("toolUse");
    });
  });

  it("streams a thinking block", async () => {
    const sseBody = sseLines([
      { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think..." } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The answer is 42." } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ]);

    await withMockFetch(sseBody, async () => {
      const msg = await anthropicAdapter.stream(
        makeConfig(),
        "test-key",
        { systemPrompt: "", messages: [], providerId: "test-anthropic", modelId: "claude-3-opus" },
        () => {},
      );

      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({ type: "thinking", thinking: "Let me think..." });
      expect(msg.content[1]).toEqual({ type: "text", text: "The answer is 42." });
      expect(msg.stopReason).toBe("stop");
    });
  });

  it("throws on non-200 response", async () => {
    await withMockFetchError(400, '{"error":{"type":"invalid_request","message":"bad request"}}', async () => {
      await expect(
        anthropicAdapter.stream(
          makeConfig(),
          "test-key",
          { systemPrompt: "", messages: [], providerId: "test-anthropic", modelId: "claude-3-opus" },
          () => {},
        ),
      ).rejects.toThrow("Anthropic API error 400");
    });
  });
});
