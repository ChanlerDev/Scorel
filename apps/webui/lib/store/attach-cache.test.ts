import { describe, expect, it, vi } from "vitest";
import {
  asClientId,
  asEventId,
  asSeq,
  asSessionId,
  type PersistentEvent,
} from "@scorel/protocol";

import { BrowserStore, type StorageLike } from "./browser-store";
import {
  AttachCache,
  type AttachCacheFile,
  type AttachCacheScope,
} from "./attach-cache";

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  private quota: number | null = null;

  setQuota(bytes: number | null): void {
    this.quota = bytes;
  }

  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    if (this.quota !== null) {
      let total = 0;
      for (const [k, v] of this.map) {
        if (k === key) continue;
        total += k.length + v.length;
      }
      total += key.length + value.length;
      if (total > this.quota) {
        const err = new Error("Quota exceeded");
        (err as Error & { name: string }).name = "QuotaExceededError";
        throw err;
      }
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
}

const SCOPE: AttachCacheScope = {
  kind: "remote",
  locator: "device:device_a/project:project-alpha",
};

function makeFile(overrides: Partial<AttachCacheFile> = {}): AttachCacheFile {
  return {
    version: 1,
    scope: SCOPE,
    sessionId: overrides.sessionId ?? "session_1",
    events: overrides.events ?? [],
    transients: overrides.transients,
  };
}

function makeUserMessage(id: string, seq: number, text: string): PersistentEvent {
  return {
    type: "user_message",
    id: asEventId(id),
    parentId: null,
    seq: asSeq(seq),
    sessionId: asSessionId("session_1"),
    clientId: asClientId("client_test"),
    ts: 0,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  } satisfies PersistentEvent;
}

function fresh(): { cache: AttachCache; raw: FakeStorage; browser: BrowserStore } {
  const raw = new FakeStorage();
  const browser = new BrowserStore({ storage: raw });
  return { cache: new AttachCache(browser), raw, browser };
}

describe("AttachCache", () => {
  it("write + read round-trip", () => {
    const { cache } = fresh();
    const file = makeFile({
      events: [makeUserMessage("evt_1", 1, "hi")],
    });
    cache.write("scope_a", "session_1", file);
    const read = cache.read("scope_a", "session_1");
    expect(read?.sessionId).toBe("session_1");
    expect(read?.events).toHaveLength(1);
    expect(read?.events[0]?.id).toBe("evt_1");
  });

  it("read returns undefined for missing entry", () => {
    const { cache } = fresh();
    expect(cache.read("scope_a", "session_x")).toBeUndefined();
  });

  it("read returns undefined when scope kind doesn't match", () => {
    const { cache, browser } = fresh();
    browser.set("attach-cache:scope_a:session_1", {
      version: 1,
      scope: { kind: "local", locator: "x" },
      sessionId: "session_1",
      events: [],
    });
    expect(cache.read("scope_a", "session_1")).toBeUndefined();
  });

  it("appendPersistent dedups by event id (upsert)", () => {
    const { cache } = fresh();
    cache.write("scope_a", "session_1", makeFile());
    const event1 = makeUserMessage("evt_1", 1, "hi");
    cache.appendPersistent("scope_a", "session_1", event1);
    cache.appendPersistent("scope_a", "session_1", event1);
    cache.appendPersistent("scope_a", "session_1", makeUserMessage("evt_2", 2, "ho"));
    const read = cache.read("scope_a", "session_1");
    expect(read?.events).toHaveLength(2);
    expect(read?.events.map((e) => e.id)).toEqual(["evt_1", "evt_2"]);
  });

  it("appendPersistent is a no-op if cache file is missing", () => {
    const { cache } = fresh();
    cache.appendPersistent("scope_a", "session_1", makeUserMessage("evt_1", 1, "hi"));
    expect(cache.read("scope_a", "session_1")).toBeUndefined();
  });

  it("appendTransient concatenates by eventId", () => {
    const { cache } = fresh();
    cache.write("scope_a", "session_1", makeFile());
    cache.appendTransient("scope_a", "session_1", { eventId: "msg_1", seq: 1, text: "Hel" });
    cache.appendTransient("scope_a", "session_1", { eventId: "msg_1", seq: 2, text: "lo" });
    cache.appendTransient("scope_a", "session_1", { eventId: "msg_2", seq: 3, text: "world" });
    const read = cache.read("scope_a", "session_1");
    expect(read?.transients).toHaveLength(2);
    const msg1 = read?.transients?.find((t) => t.eventId === "msg_1");
    expect(msg1?.text).toBe("Hello");
    expect(msg1?.seq).toBe(2);
  });

  it("truncateTransients clears the transient list", () => {
    const { cache } = fresh();
    cache.write("scope_a", "session_1", makeFile({
      transients: [{ eventId: "msg_1", seq: 1, text: "hi" }],
    }));
    cache.truncateTransients("scope_a", "session_1");
    const read = cache.read("scope_a", "session_1");
    expect(read?.transients).toEqual([]);
  });

  it("remove drops the cache file", () => {
    const { cache } = fresh();
    cache.write("scope_a", "session_1", makeFile());
    cache.remove("scope_a", "session_1");
    expect(cache.read("scope_a", "session_1")).toBeUndefined();
  });

  it("LRU eviction: when quota tight, evicts oldest non-current session", () => {
    const { cache, raw } = fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Seed two cache files.
    cache.write("scope_a", "session_old", makeFile({
      sessionId: "session_old",
      events: [makeUserMessage("evt_old", 1, "old".repeat(20))],
    }));
    cache.write("scope_a", "session_new", makeFile({
      sessionId: "session_new",
    }));
    // Touch session_new so old becomes the LRU victim.
    cache.read("scope_a", "session_new");
    // Tighten the quota so the next write triggers eviction.
    raw.setQuota(400);
    const big = makeFile({
      sessionId: "session_new",
      events: Array.from({ length: 5 }, (_, i) =>
        makeUserMessage(`evt_new_${i}`, i, "new".repeat(10)),
      ),
    });
    cache.write("scope_a", "session_new", big, {
      scopeKey: "scope_a",
      sessionId: "session_new",
    });
    expect(cache.read("scope_a", "session_old")).toBeUndefined();
    expect(cache.read("scope_a", "session_new")).toBeTruthy();
    warn.mockRestore();
  });

  it("quota fallback drops transients on the pending file before evicting", () => {
    const { cache, raw } = fresh();
    cache.write("scope_a", "session_1", makeFile({ sessionId: "session_1" }));
    raw.setQuota(300);
    const fileWithTransients = makeFile({
      sessionId: "session_1",
      transients: Array.from({ length: 50 }, (_, i) => ({
        eventId: `msg_${i}`,
        seq: i,
        text: "x".repeat(10),
      })),
    });
    cache.write("scope_a", "session_1", fileWithTransients, {
      scopeKey: "scope_a",
      sessionId: "session_1",
    });
    const read = cache.read("scope_a", "session_1");
    // Transients were dropped but the persistent file survives.
    expect(read).toBeDefined();
    expect(read?.transients ?? []).toEqual([]);
  });

  it("falls back to memory when retries exhausted", () => {
    const { cache, raw } = fresh();
    raw.setQuota(0); // every write fails
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = makeFile({ events: [makeUserMessage("evt_1", 1, "hi")] });
    cache.write("scope_a", "session_1", file, {
      scopeKey: "scope_a",
      sessionId: "session_1",
    });
    // Memory fallback returns the snapshot for the running session.
    const read = cache.read("scope_a", "session_1");
    expect(read?.events).toHaveLength(1);
    // But the underlying storage is empty.
    expect(raw.has("scorel:webui:v1:attach-cache:scope_a:session_1")).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
