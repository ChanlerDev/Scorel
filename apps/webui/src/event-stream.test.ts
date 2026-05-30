import { describe, expect, it } from "vitest";

import { asClientId, asEventId, asSeq, asSessionId } from "@scorel/protocol";

import { createEventStreamProjection, renderEventStreamRows } from "./event-stream.js";

const sessionId = asSessionId("ses_webui");
const clientId = asClientId("client_webui");

describe("WebUI event stream projection", () => {
  it("renders persistent user, assistant, and tool result rows", () => {
    const projection = createEventStreamProjection();

    projection.apply({
      type: "user_message",
      id: asEventId("evt_user"),
      parentId: null,
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1,
      message: { role: "user", content: [{ type: "text", text: "Run tests" }] },
    });
    projection.apply({
      type: "assistant_message",
      id: asEventId("evt_assistant"),
      parentId: asEventId("evt_user"),
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 2,
      message: { role: "assistant", content: [{ type: "text", text: "Tests passed" }] },
    });
    projection.apply({
      type: "tool_result",
      id: asEventId("evt_tool"),
      parentId: asEventId("evt_assistant"),
      seq: asSeq(3),
      sessionId,
      clientId,
      ts: 3,
      message: {
        role: "tool_result",
        content: [{ type: "tool_result", toolCallId: "tool_1", toolName: "Bash", result: "ok" }],
      },
    });

    expect(projection.getRows()).toEqual([
      { id: "evt_user", kind: "user", title: "User", text: "Run tests", seq: asSeq(1), status: "final" },
      { id: "evt_assistant", kind: "assistant", title: "Assistant", text: "Tests passed", seq: asSeq(2), status: "final" },
      { id: "evt_tool", kind: "tool", title: "Bash", text: "ok", seq: asSeq(3), status: "final" },
    ]);
  });

  it("merges streaming deltas and replaces them with the final assistant row", () => {
    const projection = createEventStreamProjection();

    projection.apply({
      type: "text_delta",
      eventId: asEventId("evt_assistant"),
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1,
      delta: "Hel",
    });
    projection.apply({
      type: "text_delta",
      eventId: asEventId("evt_assistant"),
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 2,
      delta: "lo",
    });

    expect(projection.getRows()).toEqual([
      { id: "evt_assistant", kind: "assistant", title: "Assistant", text: "Hello", seq: asSeq(2), status: "streaming" },
    ]);

    projection.apply({
      type: "assistant_message",
      id: asEventId("evt_assistant"),
      parentId: null,
      seq: asSeq(3),
      sessionId,
      clientId,
      ts: 3,
      message: { role: "assistant", content: [{ type: "text", text: "Hello final" }] },
    });

    expect(projection.getRows()).toEqual([
      { id: "evt_assistant", kind: "assistant", title: "Assistant", text: "Hello final", seq: asSeq(3), status: "final" },
    ]);
  });

  it("renders turn and error status rows", () => {
    const projection = createEventStreamProjection();

    projection.apply({ type: "turn_start", seq: asSeq(1), sessionId, clientId, ts: 1, turnIndex: 1 });
    projection.apply({ type: "error", seq: asSeq(2), sessionId, clientId, ts: 2, code: "internal_error", message: "Provider failed" });
    projection.apply({ type: "turn_end", seq: asSeq(3), sessionId, clientId, ts: 3, turnIndex: 1, stopReason: "error" });

    expect(projection.getRows().map((row) => row.text)).toEqual([
      "Turn 1 started",
      "Provider failed",
      "Turn 1 ended: error",
    ]);
  });

  it("escapes rendered row text", () => {
    const html = renderEventStreamRows([
      { id: "row_1", kind: "user", title: "User", text: "<script>alert(1)</script>", seq: asSeq(1), status: "final" },
    ]);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});
