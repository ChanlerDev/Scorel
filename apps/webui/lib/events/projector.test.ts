import { describe, expect, it } from "vitest";
import {
  asClientId,
  asEventId,
  asProjectId,
  asSeq,
  asSessionId,
  type ContentBlock,
  type ScorelEvent,
} from "@scorel/protocol";

import {
  appendPendingUserTurn,
  emptyProjectorState,
  projectEvent,
  projectEvents,
  type ProjectorState,
  type Turn,
} from "./projector";

const SESSION_ID = asSessionId("session_test");
const CLIENT_ID = asClientId("client_test");

let nextSeq = 1;
function seq(): number {
  return nextSeq++;
}

function reset(): void {
  nextSeq = 1;
}

function userMessage(id: string, text: string): ScorelEvent {
  return {
    type: "user_message",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    message: {
      role: "user",
      content: [{ type: "text", text }] as ContentBlock[],
    },
  };
}

function assistantMessage(
  id: string,
  text: string,
  stopReason?: "end_turn" | "tool_call",
): ScorelEvent {
  return {
    type: "assistant_message",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    message: {
      role: "assistant",
      content: [{ type: "text", text }] as ContentBlock[],
      ...(stopReason ? { stopReason } : {}),
    },
  };
}

function assistantWithToolCall(
  id: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
): ScorelEvent {
  return {
    type: "assistant_message",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    message: {
      role: "assistant",
      content: [
        { type: "tool_call", toolCallId, toolName, args },
      ] as ContentBlock[],
    },
  };
}

function toolResultEvent(
  id: string,
  toolCallId: string,
  toolName: string,
  result: unknown,
  isError?: boolean,
): ScorelEvent {
  return {
    type: "tool_result",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    message: {
      role: "tool_result",
      content: [
        {
          type: "tool_result",
          toolCallId,
          toolName,
          result,
          ...(isError ? { isError: true } : {}),
        },
      ] as ContentBlock[],
    },
  };
}

function messageStart(eventId: string): ScorelEvent {
  return {
    type: "message_start",
    eventId: asEventId(eventId),
    parentId: null,
    role: "assistant",
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
  };
}

function textDelta(eventId: string, delta: string): ScorelEvent {
  return {
    type: "text_delta",
    eventId: asEventId(eventId),
    delta,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
  };
}

function messageEnd(
  eventId: string,
  stopReason?: "end_turn" | "tool_call",
): ScorelEvent {
  return {
    type: "message_end",
    eventId: asEventId(eventId),
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    ...(stopReason ? { stopReason } : {}),
  };
}

function errorEvent(message: string): ScorelEvent {
  return {
    type: "error",
    code: "internal_error",
    message,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
  };
}

function harnessItem(
  id: string,
  content: string,
  visibility: "display" | "hidden" | "compact",
): ScorelEvent {
  return {
    type: "harness_item",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    item: {
      kind: "steer",
      origin: "user",
      content,
      visibility,
    },
  };
}

function queueUpdate(
  id: string,
  queue: "follow_up" | "steer",
  items: Array<{ id: string; text: string }>,
): ScorelEvent {
  return {
    type: "queue_update",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq()),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    queue,
    operation: "rewrite",
    anchorEventId: null,
    items: items.map((item) => ({
      id: item.id,
      content: [{ type: "text", text: item.text }] as ContentBlock[],
      createdAt: 0,
      updatedAt: 0,
      clientId: CLIENT_ID,
    })),
  };
}

describe("projector", () => {
  it("starts empty", () => {
    reset();
    const s = emptyProjectorState();
    expect(s.turns).toEqual([]);
    expect(s.queues).toEqual({ follow_up: [], steer: [] });
    expect(s.appliedSeqs.size).toBe(0);
  });

  it("projects a user_message into a user turn", () => {
    reset();
    const s = projectEvent(emptyProjectorState(), userMessage("evt_user_1", "hello"));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]?.kind).toBe("user");
    expect(s.turns[0]?.parts[0]).toEqual({ kind: "text", text: "hello" });
  });

  it("merges streaming text deltas into the in-flight assistant turn", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, messageStart("evt_a_1"));
    s = projectEvent(s, textDelta("evt_a_1", "Hel"));
    s = projectEvent(s, textDelta("evt_a_1", "lo"));
    s = projectEvent(s, textDelta("evt_a_1", " world"));
    expect(s.turns).toHaveLength(1);
    const turn = s.turns[0]!;
    expect(turn.kind).toBe("assistant");
    if (turn.kind !== "assistant") throw new Error("unreachable");
    expect(turn.streaming).toBe(true);
    expect(turn.parts[0]).toEqual({ kind: "text", text: "Hello world" });
  });

  it("upserts assistant_message replaces the streamed turn", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, messageStart("evt_a_1"));
    s = projectEvent(s, textDelta("evt_a_1", "Hel"));
    s = projectEvent(s, textDelta("evt_a_1", "lo"));
    s = projectEvent(s, assistantMessage("evt_a_1", "Hello", "end_turn"));
    expect(s.turns).toHaveLength(1);
    const turn = s.turns[0]!;
    if (turn.kind !== "assistant") throw new Error("unreachable");
    expect(turn.streaming).toBe(false);
    expect(turn.stopReason).toBe("end_turn");
    expect(turn.parts[0]).toEqual({ kind: "text", text: "Hello" });
  });

  it("dedups by seq", () => {
    reset();
    let s = emptyProjectorState();
    const ev = userMessage("evt_user_1", "hello");
    s = projectEvent(s, ev);
    s = projectEvent(s, ev);
    expect(s.turns).toHaveLength(1);
  });

  it("attaches tool_result to its issuing assistant turn", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, userMessage("evt_user_1", "list files"));
    s = projectEvent(
      s,
      assistantWithToolCall("evt_a_1", "tc_1", "ls", { path: "." }),
    );
    s = projectEvent(s, toolResultEvent("evt_tr_1", "tc_1", "ls", "file1\nfile2"));
    expect(s.turns).toHaveLength(2);
    const assistantTurn = s.turns[1]!;
    if (assistantTurn.kind !== "assistant") throw new Error("unreachable");
    const callPart = assistantTurn.parts[0];
    const resultPart = assistantTurn.parts[1];
    expect(callPart?.kind).toBe("tool_call");
    expect(resultPart?.kind).toBe("tool_result");
    if (resultPart?.kind === "tool_result") {
      expect(resultPart.toolCallId).toBe("tc_1");
      expect(resultPart.result).toBe("file1\nfile2");
    }
  });

  it("standalone tool_result without a matching assistant turn becomes a tool turn", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(
      s,
      toolResultEvent("evt_tr_1", "tc_orphan", "tool", "result"),
    );
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]?.kind).toBe("tool");
  });

  it("handles message_end without text by marking turn streaming=false", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, messageStart("evt_a_1"));
    s = projectEvent(s, textDelta("evt_a_1", "hi"));
    s = projectEvent(s, messageEnd("evt_a_1", "end_turn"));
    const turn = s.turns[0]!;
    if (turn.kind !== "assistant") throw new Error("unreachable");
    expect(turn.streaming).toBe(false);
    expect(turn.stopReason).toBe("end_turn");
  });

  it("appends error events to the latest turn", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, userMessage("evt_user_1", "do thing"));
    s = projectEvent(s, errorEvent("oh no"));
    const last = s.turns[0]!;
    expect(last.parts.at(-1)).toEqual({
      kind: "error",
      message: "oh no",
      code: "internal_error",
    });
  });

  it("error with no turns is silently ignored", () => {
    reset();
    const s = projectEvent(emptyProjectorState(), errorEvent("noop"));
    expect(s.turns).toEqual([]);
  });

  it("projects visible harness items without making them user turns", () => {
    reset();
    const s = projectEvent(emptyProjectorState(), harnessItem("evt_harness", "keep tests focused", "display"));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toEqual({
      id: "evt_harness",
      kind: "harness",
      label: "Steer",
      parts: [{ kind: "text", text: "keep tests focused" }],
    });
  });

  it("hides hidden harness items from the normal transcript", () => {
    reset();
    const s = projectEvent(emptyProjectorState(), harnessItem("evt_harness", "secret", "hidden"));
    expect(s.turns).toEqual([]);
  });

  it("projects queue_update into queue preview state", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, queueUpdate("evt_q_1", "follow_up", [
      { id: "item_1", text: "first" },
      { id: "item_2", text: "second" },
    ]));
    expect(s.queues.follow_up.map((item) => item.text)).toEqual(["first", "second"]);
    expect(s.queues.steer).toEqual([]);

    s = projectEvent(s, queueUpdate("evt_q_2", "follow_up", [
      { id: "item_2", text: "second" },
    ]));
    expect(s.queues.follow_up.map((item) => item.text)).toEqual(["second"]);
  });

  it("text_delta without prior message_start synthesizes the assistant turn", () => {
    reset();
    const s = projectEvent(emptyProjectorState(), textDelta("evt_a_1", "Hi"));
    expect(s.turns).toHaveLength(1);
    const turn = s.turns[0]!;
    expect(turn.kind).toBe("assistant");
    if (turn.kind !== "assistant") throw new Error("unreachable");
    expect(turn.streaming).toBe(true);
    expect(turn.parts[0]).toEqual({ kind: "text", text: "Hi" });
  });

  it("projectEvents folds many events", () => {
    reset();
    const events: ScorelEvent[] = [
      userMessage("evt_user_1", "hi"),
      messageStart("evt_a_1"),
      textDelta("evt_a_1", "hello"),
      assistantMessage("evt_a_1", "hello", "end_turn"),
    ];
    const s = projectEvents(emptyProjectorState(), events);
    expect(s.turns.map((t) => t.kind)).toEqual(["user", "assistant"]);
    const a = s.turns[1]!;
    if (a.kind !== "assistant") throw new Error("unreachable");
    expect(a.streaming).toBe(false);
  });

  it("optimistic user turn is replaced by daemon echo", () => {
    reset();
    let s = emptyProjectorState();
    s = appendPendingUserTurn(s, { id: "pending_local", text: "hi" });
    expect((s.turns[0] as Turn & { pending?: boolean })?.pending).toBe(true);
    s = projectEvent(s, userMessage("evt_user_1", "hi"));
    expect(s.turns).toHaveLength(1);
    const turn = s.turns[0]!;
    expect(turn.id).toBe("evt_user_1");
    expect(turn.kind).toBe("user");
    expect((turn as Turn & { pending?: boolean }).pending).toBeUndefined();
  });

  it("full reload via emptyProjectorState resets state", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, userMessage("evt_user_1", "hi"));
    s = projectEvent(s, assistantMessage("evt_a_1", "hello"));
    const fresh = emptyProjectorState();
    const reloaded = projectEvents(
      fresh,
      [userMessage("evt_user_1", "hi (reloaded)")] as ScorelEvent[],
    );
    expect(reloaded.turns).toHaveLength(1);
    expect(reloaded.turns[0]?.parts[0]).toEqual({
      kind: "text",
      text: "hi (reloaded)",
    });
  });

  it("subsequent assistant_message with same id is upserted in place", () => {
    reset();
    let s = emptyProjectorState();
    s = projectEvent(s, assistantMessage("evt_a_1", "v1"));
    s = projectEvent(s, assistantMessage("evt_a_1", "v2", "end_turn"));
    expect(s.turns).toHaveLength(1);
    const turn = s.turns[0]!;
    if (turn.kind !== "assistant") throw new Error("unreachable");
    expect(turn.parts[0]).toEqual({ kind: "text", text: "v2" });
    expect(turn.stopReason).toBe("end_turn");
  });

  it("ignores session_header events", () => {
    reset();
    const s = projectEvent(emptyProjectorState(), {
      type: "session_header",
      id: asEventId("evt_h_1"),
      parentId: null,
      seq: asSeq(seq()),
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      ts: 0,
      protocolVersion: 2,
      meta: { projectId: asProjectId("prj_test") },
    });
    expect(s.turns).toEqual([]);
  });

  it("projects thinking + text + tool_call assistant blocks into ordered parts", () => {
    reset();
    const event: ScorelEvent = {
      type: "assistant_message",
      id: asEventId("evt_a_1"),
      parentId: null,
      seq: asSeq(seq()),
      sessionId: SESSION_ID,
      clientId: CLIENT_ID,
      ts: 0,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", text: "let me think" },
          { type: "text", text: "running ls" },
          { type: "tool_call", toolCallId: "tc_1", toolName: "ls", args: {} },
        ] as ContentBlock[],
      },
    };
    const s = projectEvent(emptyProjectorState(), event);
    expect(s.turns).toHaveLength(1);
    const turn = s.turns[0]!;
    if (turn.kind !== "assistant") throw new Error("unreachable");
    expect(turn.parts.map((p) => p.kind)).toEqual([
      "thinking",
      "text",
      "tool_call",
    ]);
    expect(turn.parts[0]).toEqual({ kind: "thinking", text: "let me think" });
    expect(turn.parts[1]).toEqual({ kind: "text", text: "running ls" });
    const callPart = turn.parts[2];
    if (callPart?.kind !== "tool_call") throw new Error("unreachable");
    expect(callPart.toolCallId).toBe("tc_1");
    expect(callPart.toolName).toBe("ls");
  });

  it("does not lose appliedSeqs across calls", () => {
    reset();
    let s: ProjectorState = emptyProjectorState();
    const ev = userMessage("evt_user_1", "hi");
    s = projectEvent(s, ev);
    expect(s.appliedSeqs.has(Number(ev.seq))).toBe(true);
  });
});
