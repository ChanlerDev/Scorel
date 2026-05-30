import { describe, expect, it, vi } from "vitest";
import { BrowserStore, type StorageLike } from "./browser-store";
import { DEVICES_KEY, DevicesStore } from "./devices";

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
  raw(key: string): string | null {
    return this.getItem(key);
  }
}

function freshStore(): { devices: DevicesStore; raw: FakeStorage; browser: BrowserStore } {
  const raw = new FakeStorage();
  const browser = new BrowserStore({ storage: raw });
  return { devices: new DevicesStore(browser), raw, browser };
}

describe("DevicesStore", () => {
  it("starts empty", () => {
    const { devices } = freshStore();
    expect(devices.list()).toEqual([]);
  });

  it("create + list round trip", () => {
    const { devices } = freshStore();
    const d = devices.create({
      name: "Home",
      link: "wss://localhost:9876",
      token: "abc",
    });
    expect(d.id).toBeTruthy();
    expect(d.createdAt).toBeTypeOf("number");
    expect(devices.list()).toHaveLength(1);
    expect(devices.list()[0]).toEqual(d);
    expect(devices.get(d.id)).toEqual(d);
  });

  it("persists to underlying storage under scorel:webui:v1:devices", () => {
    const { devices, raw } = freshStore();
    devices.create({ name: "A", link: "wss://h", token: "t" });
    const stored = raw.raw(`scorel:webui:v1:${DEVICES_KEY}`);
    expect(stored).toBeTruthy();
    const arr = JSON.parse(stored as string) as Array<{ name: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]?.name).toBe("A");
  });

  it("normalizes Link before persisting", () => {
    const { devices } = freshStore();
    const d = devices.create({
      name: "Up",
      link: "WSS://Host:9876/",
      token: "t",
    });
    expect(d.link).toBe("wss://host:9876");
  });

  it("rejects invalid link", () => {
    const { devices } = freshStore();
    expect(() =>
      devices.create({ name: "x", link: "http://nope", token: "t" })
    ).toThrow(/invalid link/);
  });

  it("rejects invalid name (empty / oversize)", () => {
    const { devices } = freshStore();
    expect(() =>
      devices.create({ name: "", link: "wss://h", token: "t" })
    ).toThrow(/invalid name/);
    expect(() =>
      devices.create({ name: "a".repeat(65), link: "wss://h", token: "t" })
    ).toThrow(/invalid name/);
  });

  it("rejects invalid token (empty / oversize)", () => {
    const { devices } = freshStore();
    expect(() =>
      devices.create({ name: "x", link: "wss://h", token: "" })
    ).toThrow(/invalid token/);
    expect(() =>
      devices.create({
        name: "x",
        link: "wss://h",
        token: "x".repeat(4097),
      })
    ).toThrow(/invalid token/);
  });

  it("update mutates fields and preserves id + createdAt", () => {
    const { devices } = freshStore();
    const created = devices.create({
      name: "A",
      link: "wss://h",
      token: "t",
    });
    const updated = devices.update(created.id, {
      name: "B",
      link: "ws://Other/",
      token: "tok2",
    });
    expect(updated).toBeDefined();
    expect(updated?.id).toBe(created.id);
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.name).toBe("B");
    expect(updated?.link).toBe("ws://other");
    expect(updated?.token).toBe("tok2");
  });

  it("update returns undefined for missing id", () => {
    const { devices } = freshStore();
    expect(devices.update("missing", { name: "x" })).toBeUndefined();
  });

  it("remove drops the device", () => {
    const { devices } = freshStore();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    devices.remove(d.id);
    expect(devices.list()).toEqual([]);
    expect(devices.get(d.id)).toBeUndefined();
  });

  it("remove of unknown id is a no-op", () => {
    const { devices } = freshStore();
    devices.create({ name: "A", link: "wss://h", token: "t" });
    devices.remove("missing");
    expect(devices.list()).toHaveLength(1);
  });

  it("subscribe fires on create / update / remove", () => {
    const { devices } = freshStore();
    const listener = vi.fn();
    devices.subscribe(listener);
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    devices.update(d.id, { name: "B" });
    devices.remove(d.id);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
