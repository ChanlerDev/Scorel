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

  it("persists to underlying storage under scorel:webui:v2:devices", () => {
    const { devices, raw } = freshStore();
    devices.create({ name: "A", link: "wss://h", token: "t" });
    const stored = raw.raw(`scorel:webui:v2:${DEVICES_KEY}`);
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

  it("markIdentity stores remoteIdentity and ignores empty deviceId", () => {
    const { devices } = freshStore();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    expect(devices.markIdentity(d.id, { deviceId: "device_a", deviceDisplayName: "Alpha" }))
      .toMatchObject({ remoteIdentity: { deviceId: "device_a", deviceDisplayName: "Alpha" } });
    expect(devices.get(d.id)?.remoteIdentity).toEqual({
      deviceId: "device_a",
      deviceDisplayName: "Alpha",
    });
    // missing deviceId leaves prior identity unchanged
    devices.markIdentity(d.id, { deviceId: undefined, deviceDisplayName: "B" });
    expect(devices.get(d.id)?.remoteIdentity).toEqual({
      deviceId: "device_a",
      deviceDisplayName: "Alpha",
    });
  });

  it("markIdentity returns undefined for unknown device", () => {
    const { devices } = freshStore();
    expect(devices.markIdentity("missing", { deviceId: "x" })).toBeUndefined();
  });

  it("markConnectedAt stores timestamp", () => {
    const { devices } = freshStore();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    expect(devices.markConnectedAt(d.id, 12345)?.lastConnectedAt).toBe(12345);
    expect(devices.get(d.id)?.lastConnectedAt).toBe(12345);
  });

  it("setProjects writes the snapshot and stamps fetchedAt", () => {
    const { devices } = freshStore();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    const before = Date.now();
    const updated = devices.setProjects(d.id, [
      { projectId: "alpha", displayName: "Alpha", sessionCount: 3 },
      { projectId: "beta", displayName: "Beta", sessionCount: 1 },
    ]);
    expect(updated?.projects).toHaveLength(2);
    expect(updated?.projects?.[0]?.projectId).toBe("alpha");
    expect(updated?.projectsFetchedAt).toBeGreaterThanOrEqual(before);
  });

  it("setProjects preserves cached sessions for surviving slugs", () => {
    const { devices } = freshStore();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    devices.setProjects(d.id, [{ projectId: "alpha", displayName: "Alpha" }]);
    devices.setProjectSessions(d.id, "alpha", {
      session_1: {
        sessionId: "session_1",
        title: "Stored",
        updatedAt: 1000,
      },
    });
    // New snapshot still includes alpha but adds beta and drops gone-slug.
    devices.setProjects(d.id, [
      { projectId: "alpha", displayName: "Alpha v2" },
      { projectId: "beta", displayName: "Beta" },
    ]);
    const next = devices.get(d.id);
    const alpha = next?.projects?.find((p) => p.projectId === "alpha");
    const beta = next?.projects?.find((p) => p.projectId === "beta");
    expect(alpha?.displayName).toBe("Alpha v2");
    expect(alpha?.sessions?.session_1?.title).toBe("Stored");
    expect(alpha?.sessionsFetchedAt).toBeTypeOf("number");
    expect(beta?.sessions).toBeUndefined();
    expect(beta?.sessionsFetchedAt).toBeUndefined();
  });

  it("setProjects returns undefined for unknown device", () => {
    const { devices } = freshStore();
    expect(devices.setProjects("missing", [])).toBeUndefined();
  });

  it("setProjectSessions overwrites the session map and stamps fetchedAt", () => {
    const { devices } = freshStore();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    devices.setProjects(d.id, [{ projectId: "alpha", displayName: "Alpha" }]);
    const before = Date.now();
    devices.setProjectSessions(d.id, "alpha", {
      session_1: { sessionId: "session_1", title: "First", updatedAt: 1 },
      session_2: { sessionId: "session_2", title: "Second", updatedAt: 2 },
    });
    const project = devices
      .get(d.id)
      ?.projects?.find((p) => p.projectId === "alpha");
    expect(Object.keys(project?.sessions ?? {})).toEqual([
      "session_1",
      "session_2",
    ]);
    expect(project?.sessionsFetchedAt).toBeGreaterThanOrEqual(before);

    // A second call replaces wholesale.
    devices.setProjectSessions(d.id, "alpha", {
      session_3: { sessionId: "session_3", title: "Third", updatedAt: 3 },
    });
    expect(
      Object.keys(
        devices
          .get(d.id)
          ?.projects?.find((p) => p.projectId === "alpha")?.sessions ?? {},
      ),
    ).toEqual(["session_3"]);
  });

  it("setProjectSessions is a no-op for unknown device or unknown slug", () => {
    const { devices } = freshStore();
    expect(devices.setProjectSessions("missing", "slug", {})).toBeUndefined();
    const d = devices.create({ name: "A", link: "wss://h", token: "t" });
    devices.setProjects(d.id, [{ projectId: "alpha" }]);
    // Unknown slug returns the device unchanged (no projects mutation).
    const before = devices.get(d.id);
    const after = devices.setProjectSessions(d.id, "ghost", {
      session_1: { sessionId: "session_1", updatedAt: 1 },
    });
    expect(after).toEqual(before);
  });
});
