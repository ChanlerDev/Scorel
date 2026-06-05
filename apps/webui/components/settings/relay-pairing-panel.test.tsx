import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { BrowserStore, type StorageLike } from "../../lib/store/browser-store";
import { DevicesStore } from "../../lib/store/devices";
import { RelayPairingPanel } from "./relay-pairing-panel";

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

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as { type: string };
    this.sent.push(frame);
    if (frame.type === "create_pair_session") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          type: "relay_response",
          requestId: "webui_pair",
          ok: true,
          data: { pairCode: "123456", expiresAt: Date.now() + 60_000 },
        }),
      }));
    }
    if (frame.type === "list_authorized_devices") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({
          type: "relay_response",
          requestId: "webui_list_devices",
          ok: true,
          data: {
            devices: [
              {
                deviceId: "device_laptop",
                label: "Laptop",
                createdAt: 1,
                updatedAt: 1,
                online: true,
              },
            ],
          },
        }),
      }));
    }
  }

  close(): void {}

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as MessageEvent);
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
  window.localStorage.clear();
});

describe("RelayPairingPanel", () => {
  it("creates a pair code and stores a Relay connector after refresh", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const store = new DevicesStore(new BrowserStore({ storage: new FakeStorage() }));

    render(<RelayPairingPanel store={store} />);
    fireEvent.change(screen.getByPlaceholderText("ws://127.0.0.1:8787"), {
      target: { value: "ws://relay.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByText("123456");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Added Laptop");

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.connectors).toMatchObject([
      {
        kind: "relay",
        relayUrl: "ws://relay.test",
        deviceId: "device_laptop",
      },
    ]);
  });
});
