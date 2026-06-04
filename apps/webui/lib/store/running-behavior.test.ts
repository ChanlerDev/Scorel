import { describe, expect, it } from "vitest";

import { BrowserStore, type StorageLike } from "./browser-store";
import {
  DEFAULT_RUNNING_BEHAVIOR,
  RUNNING_BEHAVIOR_KEY,
  RunningBehaviorStore,
  oppositeRunningBehavior,
} from "./running-behavior";

class MemoryStorage implements StorageLike {
  readonly #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.#map.keys())[index] ?? null;
  }
}

describe("RunningBehaviorStore", () => {
  it("defaults to follow-up and persists user preference", () => {
    const storage = new MemoryStorage();
    const store = new RunningBehaviorStore(new BrowserStore({ storage }));

    expect(store.get()).toBe(DEFAULT_RUNNING_BEHAVIOR);
    store.set("steer");

    expect(store.get()).toBe("steer");
    expect(JSON.parse(storage.getItem(`scorel:webui:v2:${RUNNING_BEHAVIOR_KEY}`) ?? "null")).toBe("steer");
  });

  it("normalizes invalid stored values and computes the opposite behavior", () => {
    const storage = new MemoryStorage();
    storage.setItem(`scorel:webui:v2:${RUNNING_BEHAVIOR_KEY}`, JSON.stringify("bad"));
    const store = new RunningBehaviorStore(new BrowserStore({ storage }));

    expect(store.get()).toBe("follow_up");
    expect(oppositeRunningBehavior("follow_up")).toBe("steer");
    expect(oppositeRunningBehavior("steer")).toBe("follow_up");
  });
});
