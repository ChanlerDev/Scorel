import { describe, expect, it } from "vitest";

import { createRemoteProfileStore } from "./remote-store.js";

describe("remote profile local storage", () => {
  it("persists remote profiles and selected session anchors", () => {
    const storage = new MemoryStorage();
    const store = createRemoteProfileStore(storage);

    const profile = store.saveProfile({
      name: "Tokyo Workstation",
      endpoint: "ws://127.0.0.1:18789",
      token: "secret-token",
    });
    store.saveSelection(profile.id, {
      projectKey: "remote:device_tokyo:scorel",
      sessionId: "ses_alpha",
    });
    store.saveSessionAnchors(profile.id, "remote:device_tokyo:scorel", "ses_alpha", {
      persistentLastSeq: 4,
      streamLastSeq: 7,
    });

    const reloaded = createRemoteProfileStore(storage);

    expect(reloaded.listProfiles()).toEqual([
      expect.objectContaining({
        id: profile.id,
        name: "Tokyo Workstation",
        endpoint: "ws://127.0.0.1:18789",
        token: "secret-token",
        lastSelection: {
          projectKey: "remote:device_tokyo:scorel",
          sessionId: "ses_alpha",
        },
      }),
    ]);
    expect(reloaded.getSessionAnchors(profile.id, "remote:device_tokyo:scorel", "ses_alpha")).toEqual({
      persistentLastSeq: 4,
      streamLastSeq: 7,
    });
  });
});

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}
