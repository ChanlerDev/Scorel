import { describe, expect, it, vi } from "vitest";
import { BrowserStore, type StorageLike } from "./browser-store";

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
    const keys = Array.from(this.map.keys());
    return keys[index] ?? null;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}

describe("BrowserStore", () => {
  it("get returns undefined when missing", () => {
    const store = new BrowserStore({ storage: new FakeStorage() });
    expect(store.get<number>("missing")).toBeUndefined();
  });

  it("set + get round-trips JSON values", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    store.set("k", { a: 1, b: ["x"] });
    expect(store.get("k")).toEqual({ a: 1, b: ["x"] });
  });

  it("uses default namespace prefix", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    store.set("k", 1);
    expect(fake.has("scorel:webui:v1:k")).toBe(true);
  });

  it("supports custom namespace", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake, namespace: "ns:" });
    store.set("k", "v");
    expect(fake.has("ns:k")).toBe(true);
  });

  it("remove deletes value and reports undefined on get", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    store.set("k", 1);
    store.remove("k");
    expect(store.get("k")).toBeUndefined();
  });

  it("get returns undefined when JSON is corrupt", () => {
    const fake = new FakeStorage();
    fake.setItem("scorel:webui:v1:bad", "{not-json");
    const store = new BrowserStore({ storage: fake });
    expect(store.get("bad")).toBeUndefined();
  });

  it("subscribe fires on set", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    const listener = vi.fn();
    store.subscribe("k", listener);
    store.set("k", 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribe fires on remove", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    const listener = vi.fn();
    store.subscribe("k", listener);
    store.remove("k");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further notifications", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    const listener = vi.fn();
    const unsub = store.subscribe("k", listener);
    store.set("k", 1);
    unsub();
    store.set("k", 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribe is keyed: other keys do not fire listener", () => {
    const fake = new FakeStorage();
    const store = new BrowserStore({ storage: fake });
    const listener = vi.fn();
    store.subscribe("a", listener);
    store.set("b", 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("null storage no-ops on get/set/remove", () => {
    const store = new BrowserStore({ storage: null });
    expect(() => store.set("k", 1)).not.toThrow();
    expect(store.get("k")).toBeUndefined();
    expect(() => store.remove("k")).not.toThrow();
  });

  it("QuotaExceededError calls onQuotaExceeded then rethrows", () => {
    const fake = new FakeStorage();
    fake.setQuota(10);
    const onQuota = vi.fn();
    const store = new BrowserStore({ storage: fake, onQuotaExceeded: onQuota });
    expect(() => store.set("kkkkkk", "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv")).toThrow();
    expect(onQuota).toHaveBeenCalledTimes(1);
    expect(onQuota.mock.calls[0]?.[0]).toBe("kkkkkk");
  });
});
