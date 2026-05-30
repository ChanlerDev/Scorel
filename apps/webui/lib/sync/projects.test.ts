import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserStore, type StorageLike } from "../store/browser-store";
import { DevicesStore } from "../store/devices";
import {
  __resetSyncProjectsForTests,
  syncProjects,
} from "./projects";
import type { DaemonClient } from "@scorel/client";
import type { DaemonProjectSummary } from "@scorel/protocol";

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

function freshStore(): { store: DevicesStore; raw: FakeStorage } {
  const raw = new FakeStorage();
  const browser = new BrowserStore({ storage: raw });
  return { store: new DevicesStore(browser), raw };
}

function fakeProjects(): DaemonProjectSummary[] {
  return [
    {
      projectSlug: "alpha",
      displayName: "Alpha",
      workDirHint: "/Users/x/alpha",
      sessionCount: 2,
      lastSeenAt: 1000,
    },
    {
      projectSlug: "beta",
      displayName: "Beta",
      sessionCount: 0,
      lastSeenAt: 500,
    },
  ];
}

beforeEach(() => {
  __resetSyncProjectsForTests();
});

afterEach(() => {
  __resetSyncProjectsForTests();
  vi.restoreAllMocks();
});

describe("syncProjects", () => {
  it("writes the snapshot into the device store on success", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    const client = {
      listProjects: vi.fn().mockResolvedValue(fakeProjects()),
    } as unknown as DaemonClient;

    const projects = await syncProjects({
      client,
      store,
      deviceId: device.id,
    });
    expect(projects).toHaveLength(2);
    const stored = store.get(device.id);
    expect(stored?.projects?.map((p) => p.projectSlug)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(stored?.projects?.[0]?.workDirHint).toBe("/Users/x/alpha");
    expect(stored?.projectsFetchedAt).toBeTypeOf("number");
  });

  it("preserves cached sessions for surviving slugs across resync", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Old Alpha" },
    ]);
    store.setProjectSessions(device.id, "alpha", {
      session_1: { sessionId: "session_1", title: "Cached", updatedAt: 1 },
    });

    const client = {
      listProjects: vi.fn().mockResolvedValue([
        { projectSlug: "alpha", displayName: "Alpha v2", sessionCount: 1, lastSeenAt: 2 },
      ]),
    } as unknown as DaemonClient;

    await syncProjects({ client, store, deviceId: device.id });
    const alpha = store.get(device.id)?.projects?.[0];
    expect(alpha?.displayName).toBe("Alpha v2");
    expect(alpha?.sessions?.session_1?.title).toBe("Cached");
  });

  it("does not mutate Device.projects on listProjects error", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectSlug: "cached", displayName: "Cached" },
    ]);
    const client = {
      listProjects: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as DaemonClient;

    await expect(
      syncProjects({ client, store, deviceId: device.id }),
    ).rejects.toThrow(/boom/);
    expect(store.get(device.id)?.projects?.[0]?.projectSlug).toBe("cached");
  });

  it("dedupes concurrent calls per deviceId", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    let resolveCall: (value: DaemonProjectSummary[]) => void = () => {};
    const listProjects = vi.fn().mockImplementation(
      () =>
        new Promise<DaemonProjectSummary[]>((resolve) => {
          resolveCall = resolve;
        }),
    );
    const client = { listProjects } as unknown as DaemonClient;

    const a = syncProjects({ client, store, deviceId: device.id });
    const b = syncProjects({ client, store, deviceId: device.id });
    expect(listProjects).toHaveBeenCalledTimes(1);
    resolveCall(fakeProjects());
    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toBe(resB);
  });

  it("releases the dedupe slot so a retry triggers a fresh call after error", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    const listProjects = vi
      .fn<DaemonClient["listProjects"]>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(fakeProjects());
    const client = { listProjects } as unknown as DaemonClient;

    await expect(
      syncProjects({ client, store, deviceId: device.id }),
    ).rejects.toThrow(/transient/);
    await syncProjects({ client, store, deviceId: device.id });
    expect(listProjects).toHaveBeenCalledTimes(2);
    expect(store.get(device.id)?.projects).toHaveLength(2);
  });
});
