import { describe, expect, it } from "vitest";

import { BrowserStore, type StorageLike } from "./browser-store";
import { WEBUI_CLIENT_ID_KEY, WebUiClientIdentityStore } from "./client-identity";

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

describe("WebUiClientIdentityStore", () => {
  it("creates and reuses a stable clientId", () => {
    const storage = new FakeStorage();
    const browser = new BrowserStore({ storage });
    const store = new WebUiClientIdentityStore(browser);

    const first = store.getOrCreate();
    const second = new WebUiClientIdentityStore(browser).getOrCreate();

    expect(first).toMatch(/^webui_/);
    expect(second).toBe(first);
    expect(storage.getItem(`scorel:webui:v2:${WEBUI_CLIENT_ID_KEY}`)).toContain(first);
  });
});
