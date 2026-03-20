import { describe, it, expect } from "vitest";
import { EventStreamAccumulator } from "../../src/main/provider/event-stream.js";
import type { AssistantMessageEvent } from "../../src/shared/events.js";

function createAccumulator(onEvent?: (e: AssistantMessageEvent) => void) {
  return new EventStreamAccumulator(
    "test-provider",
    "test-model",
    "openai-chat-completions",
    onEvent ?? (() => {}),
  );
}

describe("EventStreamAccumulator", () => {
  // 1. Text-only stream
  it("accumulates text deltas into a single TextPart", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("Hello");
    acc.pushTextDelta(", ");
    acc.pushTextDelta("world!");
    const msg = acc.finalize("stop");

    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({ type: "text", text: "Hello, world!" });
    expect(msg.stopReason).toBe("stop");
  });

  // 2. Tool call stream
  it("accumulates tool call deltas and parses JSON arguments", () => {
    const acc = createAccumulator();
    acc.pushToolCallDelta(0, "tc1", "bash", '{"com');
    acc.pushToolCallDelta(0, undefined, undefined, 'mand":');
    acc.pushToolCallDelta(0, undefined, undefined, '"ls"}');
    acc.pushToolCallDelta(1, "tc2", "read_file", '{"path":"/tmp"}');
    const msg = acc.finalize("tool_calls");

    expect(msg.stopReason).toBe("toolUse");
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({
      type: "toolCall",
      id: "tc1",
      name: "bash",
      arguments: { command: "ls" },
    });
    expect(msg.content[1]).toEqual({
      type: "toolCall",
      id: "tc2",
      name: "read_file",
      arguments: { path: "/tmp" },
    });
  });

  // 3. Mixed text + tool calls
  it("handles mixed text and tool call deltas", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("Let me run that.");
    acc.pushToolCallDelta(0, "tc1", "bash", '{"command":"ls"}');
    const msg = acc.finalize("tool_calls");

    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: "text", text: "Let me run that." });
    expect(msg.content[1]).toEqual({
      type: "toolCall",
      id: "tc1",
      name: "bash",
      arguments: { command: "ls" },
    });
    expect(msg.stopReason).toBe("toolUse");
  });

  // 4. Usage
  it("includes usage in finalized message", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("hi");
    acc.setUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    const msg = acc.finalize("stop");

    expect(msg.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  // 5. Abort with visible output
  it("preserves text on abort", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("partial output");
    const msg = acc.abort();

    expect(msg.stopReason).toBe("aborted");
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({ type: "text", text: "partial output" });
  });

  // 6. Abort with no output
  it("returns empty content on immediate abort", () => {
    const acc = createAccumulator();
    const msg = acc.abort();

    expect(msg.stopReason).toBe("aborted");
    expect(msg.content).toHaveLength(0);
  });

  // 7. Events emitted correctly for text stream
  it("emits start, text_delta, text_end, done in order", () => {
    const events: AssistantMessageEvent["type"][] = [];
    const acc = createAccumulator((e) => events.push(e.type));

    acc.pushTextDelta("a");
    acc.pushTextDelta("b");
    acc.finalize("stop");

    expect(events).toEqual([
      "start",
      "text_delta",
      "text_delta",
      "text_end",
      "done",
    ]);
  });

  // 8. Tool call events
  it("emits toolcall_delta and toolcall_end events", () => {
    const events: AssistantMessageEvent["type"][] = [];
    const acc = createAccumulator((e) => events.push(e.type));

    acc.pushToolCallDelta(0, "tc1", "bash", '{"cmd":');
    acc.pushToolCallDelta(0, undefined, undefined, '"ls"}');
    acc.finalize("tool_calls");

    expect(events).toEqual([
      "start",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
  });

  // Additional: abort discards incomplete tool calls
  it("discards tool calls on abort", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("thinking...");
    acc.pushToolCallDelta(0, "tc1", "bash", '{"partial');
    const msg = acc.abort();

    expect(msg.stopReason).toBe("aborted");
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({ type: "text", text: "thinking..." });
  });

  // Partial snapshot is a deep copy
  it("returns independent snapshots from partial", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("a");
    const snap1 = acc.partial;
    acc.pushTextDelta("b");
    const snap2 = acc.partial;

    expect((snap1.content[0] as { type: "text"; text: string }).text).toBe("a");
    expect((snap2.content[0] as { type: "text"; text: string }).text).toBe("ab");
  });

  // finalize("length") maps to stopReason "length"
  it("maps finish_reason length to stopReason length", () => {
    const acc = createAccumulator();
    acc.pushTextDelta("truncated");
    const msg = acc.finalize("length");

    expect(msg.stopReason).toBe("length");
  });

  // Tool call with malformed JSON falls back to empty object
  it("falls back to empty arguments on malformed JSON", () => {
    const acc = createAccumulator();
    acc.pushToolCallDelta(0, "tc1", "bash", "{broken");
    const msg = acc.finalize("tool_calls");

    expect(msg.content[0]).toEqual({
      type: "toolCall",
      id: "tc1",
      name: "bash",
      arguments: {},
    });
  });

  // Thinking delta accumulation
  it("accumulates thinking deltas into a single ThinkingPart", () => {
    const acc = createAccumulator();
    acc.pushThinkingDelta("step 1...");
    acc.pushThinkingDelta(" step 2...");
    acc.pushTextDelta("answer");
    const msg = acc.finalize("stop");
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: "thinking", thinking: "step 1... step 2..." });
    expect(msg.content[1]).toEqual({ type: "text", text: "answer" });
  });

  it("emits thinking_delta and thinking_end events", () => {
    const events: AssistantMessageEvent["type"][] = [];
    const acc = createAccumulator((e) => events.push(e.type));
    acc.pushThinkingDelta("hmm");
    acc.pushTextDelta("ok");
    acc.finalize("stop");
    expect(events).toEqual(["start", "thinking_delta", "thinking_end", "text_delta", "text_end", "done"]);
  });

  it("preserves thinking signature when provided", () => {
    const acc = createAccumulator();
    acc.pushThinkingDelta("deep thought", "sig-abc");
    acc.pushTextDelta("answer");
    const msg = acc.finalize("stop");
    expect(msg.content[0]).toEqual({ type: "thinking", thinking: "deep thought", thinkingSignature: "sig-abc" });
  });

  it("discards thinking on abort", () => {
    const acc = createAccumulator();
    acc.pushThinkingDelta("partial thinking");
    acc.pushTextDelta("some text");
    const msg = acc.abort();
    expect(msg.stopReason).toBe("aborted");
    // Both thinking and toolCalls discarded, only text preserved
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({ type: "text", text: "some text" });
  });

  it("thinking then tool calls produces both parts", () => {
    const acc = createAccumulator();
    acc.pushThinkingDelta("reasoning...");
    acc.pushToolCallDelta(0, "tc1", "bash", '{"cmd":"ls"}');
    const msg = acc.finalize("tool_calls");
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: "thinking", thinking: "reasoning..." });
    expect(msg.content[1]).toEqual({ type: "toolCall", id: "tc1", name: "bash", arguments: { cmd: "ls" } });
  });

  // Event partials are snapshots (not references to internal state)
  it("event partials are independent snapshots", () => {
    const partials: AssistantMessageEvent[] = [];
    const acc = createAccumulator((e) => partials.push(e));

    acc.pushTextDelta("x");
    acc.pushTextDelta("y");

    const first = partials[1] as { type: "text_delta"; partial: { content: Array<{ type: "text"; text: string }> } };
    const second = partials[2] as { type: "text_delta"; partial: { content: Array<{ type: "text"; text: string }> } };

    expect(first.partial.content[0].text).toBe("x");
    expect(second.partial.content[0].text).toBe("xy");
  });
});
