import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserStore, type StorageLike } from "../store/browser-store";
import { DevicesStore } from "../store/devices";
import {
  __resetSyncSessionsForTests,
  syncSessions,
} from "./sessions";
import type { DaemonClient } from "@scorel/client";
import type { SessionSummary } from "@scorel/protocol";
import { asProjectId, asSeq, asSessionId } from "@scorel/protocol";

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

function fakeSessions(): SessionSummary[] {
  return [
    {
      sessionId: asSessionId("session_1"),
      title: "First",
      model: "mock",
      updatedAt: 100,
      currentSeq: asSeq(5),
      projectId: asProjectId("alpha"),
    },
    {
      sessionId: asSessionId("session_2"),
      updatedAt: 200,
      currentSeq: asSeq(7),
      projectId: asProjectId("alpha"),
    },
  ];
}

beforeEach(() => {
  __resetSyncSessionsForTests();
});

afterEach(() => {
  __resetSyncSessionsForTests();
  vi.restoreAllMocks();
});

describe("syncSessions", () => {
  it("writes the daemon-truth session map on success", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    const listSessions = vi
      .fn<DaemonClient["listSessions"]>()
      .mockResolvedValue(fakeSessions());
    const client = { listSessions } as unknown as DaemonClient;

    await syncSessions({
      client,
      store,
      deviceId: device.id,
      projectId: "alpha",
    });
    expect(listSessions).toHaveBeenCalledWith({
      projectId: "alpha",
      limit: 200,
    });
    const stored = store
      .get(device.id)
      ?.projects?.find((p) => p.projectId === "alpha");
    expect(Object.keys(stored?.sessions ?? {})).toEqual([
      "session_1",
      "session_2",
    ]);
    expect(stored?.sessions?.session_1?.title).toBe("First");
    expect(stored?.sessions?.session_1?.currentSeq).toBe(5);
    expect(stored?.sessionsFetchedAt).toBeTypeOf("number");
  });

  it("respects an explicit limit", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    const listSessions = vi
      .fn<DaemonClient["listSessions"]>()
      .mockResolvedValue([]);
    const client = { listSessions } as unknown as DaemonClient;

    await syncSessions({
      client,
      store,
      deviceId: device.id,
      projectId: "alpha",
      limit: 50,
    });
    expect(listSessions).toHaveBeenCalledWith({
      projectId: "alpha",
      limit: 50,
    });
  });

  it("does not erase cached sessions on listSessions error", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    store.setProjectSessions(device.id, "alpha", {
      session_cached: {
        sessionId: "session_cached",
        title: "Cached",
        updatedAt: 1,
      },
    });
    const listSessions = vi
      .fn<DaemonClient["listSessions"]>()
      .mockRejectedValue(new Error("net down"));
    const client = { listSessions } as unknown as DaemonClient;

    await expect(
      syncSessions({
        client,
        store,
        deviceId: device.id,
        projectId: "alpha",
      }),
    ).rejects.toThrow(/net down/);
    const project = store
      .get(device.id)
      ?.projects?.find((p) => p.projectId === "alpha");
    expect(project?.sessions?.session_cached?.title).toBe("Cached");
  });

  it("dedupes concurrent calls per (deviceId, projectId)", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    let resolveCall: (value: SessionSummary[]) => void = () => {};
    const listSessions = vi
      .fn<DaemonClient["listSessions"]>()
      .mockImplementation(
        () =>
          new Promise<SessionSummary[]>((resolve) => {
            resolveCall = resolve;
          }),
      );
    const client = { listSessions } as unknown as DaemonClient;

    const a = syncSessions({
      client,
      store,
      deviceId: device.id,
      projectId: "alpha",
    });
    const b = syncSessions({
      client,
      store,
      deviceId: device.id,
      projectId: "alpha",
    });
    expect(listSessions).toHaveBeenCalledTimes(1);
    resolveCall(fakeSessions());
    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toBe(resB);
  });

  it("does not dedupe across different project slugs", async () => {
    const { store } = freshStore();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha" },
      { projectId: "beta" },
    ]);
    const listSessions = vi
      .fn<DaemonClient["listSessions"]>()
      .mockResolvedValue([]);
    const client = { listSessions } as unknown as DaemonClient;

    await Promise.all([
      syncSessions({
        client,
        store,
        deviceId: device.id,
        projectId: "alpha",
      }),
      syncSessions({
        client,
        store,
        deviceId: device.id,
        projectId: "beta",
      }),
    ]);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });
});
