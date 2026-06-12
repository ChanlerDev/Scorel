import { describe, expect, it } from "vitest";

import { asClientId, asEventId, asSeq, asSessionId, type ScorelEvent } from "@scorel/protocol";

import { emptyProjectorState, projectEvents } from "./projector.js";

describe("chatbox projector", () => {
  it("streams thinking deltas into the active assistant turn", () => {
    const events: ScorelEvent[] = [
      {
        type: "message_start",
        seq: asSeq(1),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("cli_1"),
        ts: 1,
        eventId: asEventId("evt_assistant"),
        parentId: null,
        role: "assistant",
      },
      {
        type: "thinking_delta",
        seq: asSeq(2),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("cli_1"),
        ts: 2,
        eventId: asEventId("evt_assistant"),
        delta: "check",
      },
      {
        type: "text_delta",
        seq: asSeq(3),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("cli_1"),
        ts: 3,
        eventId: asEventId("evt_assistant"),
        delta: "done",
      },
    ];

    const state = projectEvents(emptyProjectorState(), events);

    expect(state.turns).toEqual([
      {
        id: "evt_assistant",
        kind: "assistant",
        streaming: true,
        parts: [
          { kind: "thinking", text: "check" },
          { kind: "text", text: "done" },
        ],
      },
    ]);
  });

  it("reconciles streaming thinking with the final assistant message", () => {
    const events: ScorelEvent[] = [
      {
        type: "thinking_delta",
        seq: asSeq(1),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("cli_1"),
        ts: 1,
        eventId: asEventId("evt_assistant"),
        delta: "draft",
      },
      {
        type: "assistant_message",
        seq: asSeq(2),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("cli_1"),
        ts: 2,
        id: asEventId("evt_assistant"),
        parentId: null,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", text: "final thinking" },
            { type: "text", text: "final answer" },
          ],
          stopReason: "end_turn",
        },
      },
    ];

    const state = projectEvents(emptyProjectorState(), events);

    expect(state.turns).toEqual([
      {
        id: "evt_assistant",
        kind: "assistant",
        streaming: false,
        stopReason: "end_turn",
        parts: [
          { kind: "thinking", text: "final thinking" },
          { kind: "text", text: "final answer" },
        ],
      },
    ]);
  });
});
