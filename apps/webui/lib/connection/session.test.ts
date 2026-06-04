import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  asClientId,
  asEventId,
  asProjectId,
  asSeq,
  asSessionId,
  type ClientId,
  type ContentBlock,
  type EventId,
  type PersistentEvent,
  type ScorelEvent,
  type SendMessageOptions,
  type SendMessageResponse,
  type Seq,
  type SessionId,
  type Unsubscribe,
} from "@scorel/protocol";
import type { DaemonClient, DaemonConnectionIdentity } from "@scorel/client";

import { BrowserStore, type StorageLike } from "../store/browser-store";
import { AttachCache } from "../store/attach-cache";
import {
  createSessionAttachController,
  type SessionAttachSnapshot,
} from "./session";

const SESSION_ID = asSessionId("session_test");
const CLIENT_ID = asClientId("client_test");

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
}

type ResyncResponse = {
  events: ScorelEvent[];
  throughSeq: Seq;
  mode: "stream_resume" | "persistent_fallback" | "full_reload";
};

class FakeDaemonClient {
  clientId = CLIENT_ID;
  sessionId: SessionId | null = null;
  connectCalls = 0;
  resyncCalls: Array<{ persistentLastSeq?: Seq; streamLastSeq?: Seq }> = [];
  sentMessages: string[] = [];
  sentMessageOptions: Array<SendMessageOptions | undefined> = [];
  cancelCalls = 0;
  cancelImpl: () => Promise<{ sessionId: SessionId; cancelled: boolean }> = async () => ({
    sessionId: this.sessionId ?? SESSION_ID,
    cancelled: true,
  });
  connectionIdentity: DaemonConnectionIdentity = {};
  readonly subscribers = new Set<(event: ScorelEvent) => void>();
  resyncResult: ResyncResponse = {
    events: [],
    throughSeq: asSeq(0),
    mode: "stream_resume",
  };

  async connect(sessionId?: SessionId): Promise<void> {
    this.connectCalls += 1;
    if (sessionId) this.sessionId = sessionId;
  }

  async loadSession(sessionId: SessionId) {
    this.sessionId = sessionId;
    return {
      sessionId,
      activeLeafId: null,
      currentSeq: asSeq(0),
      events: [],
      meta: { projectId: asProjectId("prj_test") },
    };
  }

  async resync(anchors?: Seq | { persistentLastSeq?: Seq; streamLastSeq?: Seq }): Promise<ResyncResponse> {
    if (anchors && typeof anchors === "object") {
      const captured: { persistentLastSeq?: Seq; streamLastSeq?: Seq } = {};
      if (anchors.persistentLastSeq !== undefined) {
        captured.persistentLastSeq = anchors.persistentLastSeq;
      }
      if (anchors.streamLastSeq !== undefined) {
        captured.streamLastSeq = anchors.streamLastSeq;
      }
      this.resyncCalls.push(captured);
    } else {
      this.resyncCalls.push({});
    }
    // Dispatch the events through subscribers, just like the real client does.
    for (const event of this.resyncResult.events) {
      for (const subscriber of this.subscribers) subscriber(event);
    }
    return this.resyncResult;
  }

  subscribe(handler: (event: ScorelEvent) => void): Unsubscribe {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  async sendMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResponse> {
    this.sentMessages.push(content);
    this.sentMessageOptions.push(options);
    return {
      status: "completed",
      userEventId: asEventId("evt_user_1"),
      assistantEventId: asEventId("evt_a_1"),
    };
  }

  async cancel(): Promise<{ sessionId: SessionId; cancelled: boolean }> {
    this.cancelCalls += 1;
    return this.cancelImpl();
  }

  // The real client surface includes more methods; the controller only uses
  // the five above plus `sessionId` and `connectionIdentity`.
  asClient(): DaemonClient {
    return this as unknown as DaemonClient;
  }
}

function userMessage(id: string, seq: number, text: string): PersistentEvent {
  return {
    type: "user_message",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    message: { role: "user", content: [{ type: "text", text }] as ContentBlock[] },
  };
}

function queueUpdate(
  id: string,
  seq: number,
  queue: "follow_up" | "steer",
  text: string,
): PersistentEvent {
  return {
    type: "queue_update",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    queue,
    operation: "rewrite",
    anchorEventId: null,
    items: [
      {
        id: "item_1",
        content: [{ type: "text", text }] as ContentBlock[],
        createdAt: 0,
        updatedAt: 0,
        clientId: CLIENT_ID,
      },
    ],
  };
}

function assistantMessage(id: string, seq: number, text: string): PersistentEvent {
  return {
    type: "assistant_message",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    ts: 0,
    message: {
      role: "assistant",
      content: [{ type: "text", text }] as ContentBlock[],
      stopReason: "end_turn",
    },
  };
}

function makeAttachCache(): AttachCache {
  const browser = new BrowserStore({ storage: new FakeStorage() });
  return new AttachCache(browser);
}

function turnStart(seq: number, turnIndex = 1, clientId: ClientId = CLIENT_ID): ScorelEvent {
  return {
    type: "turn_start",
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId,
    ts: 0,
    turnIndex,
  };
}

function turnEnd(seq: number, turnIndex = 1, clientId: ClientId = CLIENT_ID): ScorelEvent {
  return {
    type: "turn_end",
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId,
    ts: 0,
    turnIndex,
  };
}

function messageStart(eventId: string, seq: number, clientId: ClientId = CLIENT_ID): ScorelEvent {
  return {
    type: "message_start",
    eventId: asEventId(eventId),
    parentId: null,
    role: "assistant",
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId,
    ts: 0,
  };
}

function textDelta(eventId: string, seq: number, delta: string, clientId: ClientId = CLIENT_ID): ScorelEvent {
  return {
    type: "text_delta",
    eventId: asEventId(eventId),
    delta,
    seq: asSeq(seq),
    sessionId: SESSION_ID,
    clientId,
    ts: 0,
  };
}

describe("createSessionAttachController", () => {
  it("with empty cache: connect → resync(full_reload) populates state", async () => {
    const fake = new FakeDaemonClient();
    fake.resyncResult = {
      mode: "full_reload",
      throughSeq: asSeq(2),
      events: [
        userMessage("evt_u_1", 1, "hi"),
        assistantMessage("evt_a_1", 2, "hello"),
      ],
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    expect(fake.connectCalls).toBe(1);
    expect(fake.resyncCalls).toHaveLength(1);
    expect(fake.resyncCalls[0]).toEqual({
      persistentLastSeq: asSeq(0),
      streamLastSeq: asSeq(0),
    });
    const last = snapshots.at(-1)!;
    expect(last.loading).toBe(false);
    expect(last.resyncMode).toBe("full_reload");
    expect(last.state.turns.map((t) => t.kind)).toEqual(["user", "assistant"]);
  });

  it("with cache: hydrates instantly, then stream_resume appends without dupes", async () => {
    const cache = makeAttachCache();
    cache.write("scope_a", String(SESSION_ID), {
      version: 1,
      scope: { kind: "remote", locator: "scope:scope_a" },
      sessionId: String(SESSION_ID),
      events: [userMessage("evt_u_1", 1, "hi")],
    });
    const fake = new FakeDaemonClient();
    fake.resyncResult = {
      mode: "stream_resume",
      throughSeq: asSeq(3),
      events: [
        // The same user message that's already in cache — projector should dedup.
        userMessage("evt_u_1", 1, "hi"),
        assistantMessage("evt_a_1", 2, "hello"),
      ],
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: cache,
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    // First snapshot is the hydrated cache (loading=true).
    expect(snapshots[0]?.loading).toBe(true);
    expect(snapshots[0]?.state.turns).toHaveLength(1);
    // Final snapshot has both turns.
    const final = snapshots.at(-1)!;
    expect(final.resyncMode).toBe("stream_resume");
    expect(final.state.turns.map((t) => t.id)).toEqual(["evt_u_1", "evt_a_1"]);
  });

  it("persistent_fallback mode advances anchors and projects events", async () => {
    const fake = new FakeDaemonClient();
    fake.resyncResult = {
      mode: "persistent_fallback",
      throughSeq: asSeq(5),
      events: [
        userMessage("evt_u_1", 1, "hi"),
        assistantMessage("evt_a_1", 2, "hello"),
      ],
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    const last = snapshots.at(-1)!;
    expect(last.resyncMode).toBe("persistent_fallback");
    expect(last.state.turns).toHaveLength(2);
  });

  it("send: optimistic user turn appears, then daemon echo replaces it", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    snapshots.length = 0;
    const sendPromise = controller.send("hello there");
    // Right after send: optimistic turn is present and pending.
    const optimistic = snapshots.at(-1)!;
    const optimisticTurn = optimistic.state.turns[0]!;
    expect(optimisticTurn.kind).toBe("user");
    expect(optimisticTurn.parts[0]).toEqual({ kind: "text", text: "hello there" });
    expect((optimisticTurn as { pending?: boolean }).pending).toBe(true);
    // Now simulate the daemon echo by dispatching the event through subscribers.
    for (const sub of fake.subscribers) {
      sub(userMessage("evt_u_1", 1, "hello there"));
    }
    await sendPromise;
    const final = snapshots.at(-1)!;
    expect(final.state.turns).toHaveLength(1);
    expect(final.state.turns[0]?.id).toBe("evt_u_1");
    expect((final.state.turns[0] as { pending?: boolean }).pending).toBeUndefined();
  });

  it("send: running behavior is forwarded without creating a user bubble while in-flight", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    for (const sub of fake.subscribers) sub(turnStart(5));
    snapshots.length = 0;

    const sendPromise = controller.send("guide current run", { runningBehavior: "steer" });

    expect(fake.sentMessages).toEqual(["guide current run"]);
    expect(fake.sentMessageOptions).toEqual([
      { runningBehavior: "steer" },
    ]);
    expect(snapshots).toHaveLength(0);
    for (const sub of fake.subscribers) {
      sub(queueUpdate("evt_q_1", 6, "steer", "guide current run"));
    }
    await sendPromise;
  });

  it("send: request completion resync recovers a missed persistent acceptance event", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    fake.resyncResult = {
      mode: "stream_resume",
      throughSeq: asSeq(1),
      events: [userMessage("evt_recovered_user", 1, "lost live event")],
    };

    await controller.send("lost live event");

    expect(fake.resyncCalls.at(-1)).toEqual({
      persistentLastSeq: asSeq(0),
      streamLastSeq: asSeq(0),
    });
    expect(snapshots.at(-1)?.state.turns[0]?.id).toBe("evt_recovered_user");
    expect(snapshots.at(-1)?.error).toBeUndefined();
  });

  it("send: request completion without live or resynced acceptance fails instead of hanging", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    fake.resyncResult = {
      mode: "stream_resume",
      throughSeq: asSeq(0),
      events: [],
    };

    await expect(controller.send("never accepted")).rejects.toThrow(
      "send_message completed without matching persistent event",
    );
    expect(snapshots.at(-1)?.error?.reason).toBe("send_failed");
  });

  it("send: empty/whitespace input is ignored", async () => {
    const fake = new FakeDaemonClient();
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: () => {},
    });
    await controller.start();
    await controller.send("");
    await controller.send("   \n  ");
    expect(fake.sentMessages).toEqual([]);
  });

  it("stop unsubscribes — late events do not mutate state", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    const len = snapshots.length;
    controller.stop();
    for (const sub of fake.subscribers) {
      sub(userMessage("evt_u_late", 1, "should be ignored"));
    }
    expect(snapshots.length).toBe(len);
  });

  it("resync error surfaces in snapshot.error", async () => {
    const fake = new FakeDaemonClient();
    fake.resync = async () => {
      throw new Error("boom");
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    const last = snapshots.at(-1)!;
    expect(last.error?.reason).toBe("resync_failed");
    expect(last.error?.message).toBe("boom");
  });

  it("turn_start flips inFlight true; turn_end flips it false", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    expect(snapshots.at(-1)!.inFlight).toBe(false);
    for (const sub of fake.subscribers) sub(turnStart(10));
    expect(snapshots.at(-1)!.inFlight).toBe(true);
    expect(snapshots.at(-1)!.cancelling).toBe(false);
    for (const sub of fake.subscribers) sub(turnEnd(11));
    expect(snapshots.at(-1)!.inFlight).toBe(false);
    expect(snapshots.at(-1)!.cancelling).toBe(false);
  });

  it("controller.cancel sets cancelling; subsequent turn_end clears it", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    for (const sub of fake.subscribers) sub(turnStart(10));
    expect(snapshots.at(-1)!.inFlight).toBe(true);
    await controller.cancel();
    expect(fake.cancelCalls).toBe(1);
    expect(snapshots.at(-1)!.cancelling).toBe(true);
    expect(snapshots.at(-1)!.inFlight).toBe(true);
    // Late turn_end clears both flags cleanly (race-condition test).
    for (const sub of fake.subscribers) sub(turnEnd(11));
    const final = snapshots.at(-1)!;
    expect(final.inFlight).toBe(false);
    expect(final.cancelling).toBe(false);
  });

  it("cancel client error captured into snapshot.error and clears cancelling", async () => {
    const fake = new FakeDaemonClient();
    fake.cancelImpl = async () => {
      throw new Error("cancel boom");
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    for (const sub of fake.subscribers) sub(turnStart(10));
    await controller.cancel();
    const final = snapshots.at(-1)!;
    expect(final.cancelling).toBe(false);
    expect(final.error?.reason).toBe("cancel_failed");
    expect(final.error?.message).toBe("cancel boom");
  });

  it("classifies transport_disconnected during resync as disconnected", async () => {
    const fake = new FakeDaemonClient();
    fake.resync = async () => {
      const err = new Error("WsTransport is not connected");
      (err as Error & { code?: string }).code = "transport_disconnected";
      throw err;
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    const last = snapshots.at(-1)!;
    expect(last.error?.reason).toBe("disconnected");
  });

  it("classifies transport_disconnected during send as disconnected", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    fake.sendMessage = async () => {
      const err = new Error("WsTransport is not connected");
      (err as Error & { code?: string }).code = "transport_disconnected";
      throw err;
    };
    await expect(controller.send("hi")).rejects.toThrow();
    const last = snapshots.at(-1)!;
    expect(last.error?.reason).toBe("disconnected");
  });

  it("classifies transport_disconnected during cancel as disconnected", async () => {
    const fake = new FakeDaemonClient();
    fake.cancelImpl = async () => {
      const err = new Error("WsTransport is not connected");
      (err as Error & { code?: string }).code = "transport_disconnected";
      throw err;
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    for (const sub of fake.subscribers) sub(turnStart(10));
    await controller.cancel();
    const last = snapshots.at(-1)!;
    expect(last.error?.reason).toBe("disconnected");
  });

  it("snapshot exposes diagnostics: persistent/stream seq + identity + sessionId", async () => {
    const fake = new FakeDaemonClient();
    fake.connectionIdentity = {
      deviceId: "remote-device-x" as unknown as DaemonConnectionIdentity["deviceId"],
    };
    fake.resyncResult = {
      mode: "full_reload",
      throughSeq: asSeq(2),
      events: [userMessage("evt_u_1", 1, "hi"), assistantMessage("evt_a_1", 2, "hello")],
    };
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    const last = snapshots.at(-1)!;
    expect(last.sessionId).toBe(String(SESSION_ID));
    expect(last.remoteDeviceId).toBe("remote-device-x");
    expect(last.projectId).toBe("prj_test");
    expect(last.persistentLastSeq).toBe(2);
    expect(last.streamLastSeq).toBe(2);
  });
});

describe("createSessionAttachController text_delta rAF batching", () => {
  let queue: Array<(ts: number) => void>;

  beforeEach(() => {
    queue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (ts: number) => void) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      // Drop the queued callback so a stray flush cannot run later. The real
      // browser cancels by handle; for the test we treat any cancel as
      // "drop everything pending" because the controller only ever holds one.
      queue.length = 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrame(): void {
    const cb = queue.shift();
    cb?.(0);
  }

  it("coalesces a burst of three text_delta events into one snapshot per frame", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    // Establish a streaming assistant via message_start; this is a non-delta
    // event so it must flush synchronously.
    for (const sub of fake.subscribers) sub(messageStart("evt_a_1", 10));
    const baseline = snapshots.length;

    // Burst: three text_delta events arrive back-to-back. None should emit
    // until the next frame.
    for (const sub of fake.subscribers) sub(textDelta("evt_a_1", 11, "He"));
    for (const sub of fake.subscribers) sub(textDelta("evt_a_1", 12, "ll"));
    for (const sub of fake.subscribers) sub(textDelta("evt_a_1", 13, "o"));
    expect(snapshots.length).toBe(baseline);
    expect(queue.length).toBe(1);

    // Frame fires: exactly one snapshot is appended with the merged state.
    flushFrame();
    expect(snapshots.length).toBe(baseline + 1);
    const merged = snapshots.at(-1)!;
    const assistant = merged.state.turns.find((t) => t.id === "evt_a_1");
    expect(assistant).toBeDefined();
    if (assistant && assistant.kind === "assistant") {
      const textPart = assistant.parts.find((p) => p.kind === "text");
      expect(textPart && textPart.kind === "text" ? textPart.text : "").toBe("Hello");
    }
  });

  it("non-delta event flushes synchronously and cancels the pending batch", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    for (const sub of fake.subscribers) sub(messageStart("evt_a_1", 10));
    for (const sub of fake.subscribers) sub(textDelta("evt_a_1", 11, "Hi"));
    expect(queue.length).toBe(1);
    const before = snapshots.length;

    // turn_end is a non-delta event: it must emit immediately and cancel the
    // pending rAF so the deferred snapshot does not overwrite the final
    // state.
    for (const sub of fake.subscribers) sub(turnEnd(12));
    expect(snapshots.length).toBe(before + 1);
    // Cancel cleared the queue so subsequent frame flushes are no-ops.
    expect(queue.length).toBe(0);

    // Even if a stale frame somehow ran, it must not produce another snapshot
    // for this turn_end event.
    flushFrame();
    expect(snapshots.length).toBe(before + 1);
  });

  it("stop() cancels any pending rAF batch", async () => {
    const fake = new FakeDaemonClient();
    const snapshots: SessionAttachSnapshot[] = [];
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
      projectId: "prj_test",
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    for (const sub of fake.subscribers) sub(messageStart("evt_a_1", 10));
    for (const sub of fake.subscribers) sub(textDelta("evt_a_1", 11, "Hi"));
    expect(queue.length).toBe(1);

    controller.stop();
    expect(queue.length).toBe(0);
    flushFrame();
    // No further snapshots after stop.
    const finalLength = snapshots.length;
    flushFrame();
    expect(snapshots.length).toBe(finalLength);
  });
});
