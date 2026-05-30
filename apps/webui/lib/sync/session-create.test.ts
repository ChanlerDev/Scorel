import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserStore, type StorageLike } from "../store/browser-store";
import { DevicesStore } from "../store/devices";
import {
  NEW_CHAT_DEFAULT_TITLE,
  createSessionForProject,
} from "./session-create";
import type { DaemonClient } from "@scorel/client";
import { asSessionId } from "@scorel/protocol";

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

function freshStore(): { store: DevicesStore } {
  const browser = new BrowserStore({ storage: new FakeStorage() });
  return { store: new DevicesStore(browser) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createSessionForProject", () => {
  it("calls client.createSession with the project slug + defaults and prepends to cache", async () => {
    const { store } = freshStore();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    store.setProjects(device.id, [{ projectSlug: "alpha", displayName: "Alpha" }]);
    // Seed an existing session so we can verify merge preserves it.
    store.setProjectSessions(device.id, "alpha", {
      session_old: {
        sessionId: "session_old",
        title: "Existing",
        updatedAt: 100,
      },
    });

    const createSession = vi
      .fn<DaemonClient["createSession"]>()
      .mockResolvedValue(asSessionId("session_new"));
    const client = { createSession } as unknown as DaemonClient;

    const result = await createSessionForProject({
      client,
      store,
      deviceId: device.id,
      projectSlug: "alpha",
      defaults: { model: "gpt-x", title: "My chat" },
    });

    expect(result).toEqual({ sessionId: "session_new" });
    expect(createSession).toHaveBeenCalledWith({
      meta: {
        projectSlug: "alpha",
        title: "My chat",
        model: "gpt-x",
      },
    });

    const project = store
      .get(device.id)
      ?.projects?.find((p) => p.projectSlug === "alpha");
    // Both sessions present — old preserved, new added.
    expect(Object.keys(project?.sessions ?? {}).sort()).toEqual([
      "session_new",
      "session_old",
    ]);
    expect(project?.sessions?.session_new?.title).toBe("My chat");
    expect(project?.sessions?.session_new?.model).toBe("gpt-x");
    expect(project?.sessions?.session_new?.currentSeq).toBe(0);
    expect(project?.sessions?.session_new?.updatedAt).toBe(
      Date.parse("2026-05-31T12:00:00Z"),
    );
    // Pre-existing session untouched.
    expect(project?.sessions?.session_old?.title).toBe("Existing");
  });

  it("falls back to default title when defaults are absent", async () => {
    const { store } = freshStore();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    store.setProjects(device.id, [{ projectSlug: "alpha" }]);

    const createSession = vi
      .fn<DaemonClient["createSession"]>()
      .mockResolvedValue(asSessionId("session_def"));
    const client = { createSession } as unknown as DaemonClient;

    await createSessionForProject({
      client,
      store,
      deviceId: device.id,
      projectSlug: "alpha",
    });

    expect(createSession).toHaveBeenCalledWith({
      meta: {
        projectSlug: "alpha",
        title: NEW_CHAT_DEFAULT_TITLE,
      },
    });
    const project = store
      .get(device.id)
      ?.projects?.find((p) => p.projectSlug === "alpha");
    expect(project?.sessions?.session_def?.title).toBe(NEW_CHAT_DEFAULT_TITLE);
    expect(project?.sessions?.session_def?.model).toBeUndefined();
  });

  it("does not mutate the cache when createSession rejects", async () => {
    const { store } = freshStore();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    store.setProjects(device.id, [{ projectSlug: "alpha" }]);
    store.setProjectSessions(device.id, "alpha", {
      session_old: {
        sessionId: "session_old",
        title: "Existing",
        updatedAt: 1,
      },
    });
    const before = JSON.stringify(
      store
        .get(device.id)
        ?.projects?.find((p) => p.projectSlug === "alpha")?.sessions,
    );

    const createSession = vi
      .fn<DaemonClient["createSession"]>()
      .mockRejectedValue(new Error("net down"));
    const client = { createSession } as unknown as DaemonClient;

    await expect(
      createSessionForProject({
        client,
        store,
        deviceId: device.id,
        projectSlug: "alpha",
      }),
    ).rejects.toThrow(/net down/);

    const after = JSON.stringify(
      store
        .get(device.id)
        ?.projects?.find((p) => p.projectSlug === "alpha")?.sessions,
    );
    expect(after).toBe(before);
  });
});
