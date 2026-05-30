import { describe, expect, it } from "vitest";
import {
  asClientId,
  asEventId,
  asSeq,
  asSessionId,
  type ContentBlock,
  type EventId,
  type PersistentEvent,
  type ScorelEvent,
  type Seq,
  type SessionId,
  type Unsubscribe,
} from "@scorel/protocol";
import type { DaemonClient } from "@scorel/client";

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
  sessionId: SessionId | null = null;
  connectCalls = 0;
  resyncCalls: Array<{ persistentLastSeq?: Seq; streamLastSeq?: Seq }> = [];
  sentMessages: string[] = [];
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
  ): Promise<{ userEventId: EventId; assistantEventId: EventId }> {
    this.sentMessages.push(content);
    return {
      userEventId: asEventId("evt_user_1"),
      assistantEventId: asEventId("evt_a_1"),
    };
  }

  // The real client surface includes more methods; the controller only uses
  // the four above plus `sessionId`.
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
      attachCache: makeAttachCache(),
      onState: (snapshot) => snapshots.push(snapshot),
    });
    await controller.start();
    snapshots.length = 0;
    await controller.send("hello there");
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
    const final = snapshots.at(-1)!;
    expect(final.state.turns).toHaveLength(1);
    expect(final.state.turns[0]?.id).toBe("evt_u_1");
    expect((final.state.turns[0] as { pending?: boolean }).pending).toBeUndefined();
  });

  it("send: empty/whitespace input is ignored", async () => {
    const fake = new FakeDaemonClient();
    const controller = createSessionAttachController({
      client: fake.asClient(),
      scopeKey: "scope_a",
      sessionId: SESSION_ID,
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
      attachCache: makeAttachCache(),
      onState: (s) => snapshots.push(s),
    });
    await controller.start();
    const last = snapshots.at(-1)!;
    expect(last.error?.reason).toBe("resync_failed");
    expect(last.error?.message).toBe("boom");
  });
});
