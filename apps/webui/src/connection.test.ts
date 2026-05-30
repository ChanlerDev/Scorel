import { describe, expect, it } from "vitest";

import { asClientId, asSessionId } from "@scorel/protocol";

import { connectToRemoteSession, normalizeDeviceLink } from "./connection.js";

class TestWebSocket {
  static readonly sentMessages: string[] = [];
  readonly readyState = 1;
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    TestWebSocket.sentMessages.length = 0;
    queueMicrotask(() => this.#emit("open"));
  }

  send(data: string): void {
    TestWebSocket.sentMessages.push(data);
    const message = JSON.parse(data) as { type: string; clientId: string; sessionId?: string };
    if (message.type === "connect") {
      queueMicrotask(() =>
        this.#emit("message", {
          data: JSON.stringify({
            type: "connected",
            clientId: message.clientId,
            sessionId: message.sessionId,
            currentSeq: 0,
            deviceId: "device_webui_test",
            deviceDisplayName: "WebUI Test Daemon",
            projectSlug: "scorel",
          }),
        }),
      );
    }
  }

  close(): void {}

  addEventListener(type: "open", listener: () => void, options?: { once?: boolean }): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void, options?: { once?: boolean }): void;
  addEventListener(type: "close", listener: () => void, options?: { once?: boolean }): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (() => void) | ((event: unknown) => void),
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener as (event: unknown) => void);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: "error", listener: (event: unknown) => void): void {
    this.#listeners.get(type)?.delete(listener as (event: unknown) => void);
  }

  #emit(type: string, event?: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("connectToRemoteSession", () => {
  it("normalizes device links into browser WebSocket URLs", () => {
    expect(normalizeDeviceLink("127.0.0.1:18789")).toBe("ws://127.0.0.1:18789");
    expect(normalizeDeviceLink("localhost:18789")).toBe("ws://localhost:18789");
    expect(normalizeDeviceLink("http://127.0.0.1:18789")).toBe("ws://127.0.0.1:18789");
    expect(normalizeDeviceLink("https://example.com/scorel")).toBe("wss://example.com/scorel");
    expect(normalizeDeviceLink("ws://127.0.0.1:18789")).toBe("ws://127.0.0.1:18789");
    expect(normalizeDeviceLink("wss://example.com/scorel")).toBe("wss://example.com/scorel");
  });

  it("rejects empty or non-websocket device links with product copy", () => {
    expect(() => normalizeDeviceLink("")).toThrow("Device Link is required");
    expect(() => normalizeDeviceLink("ftp://127.0.0.1:18789")).toThrow("Device Link must be a ws:// or wss:// endpoint");
  });

  it("connects through the browser-safe WsTransport and records daemon identity", async () => {
    const result = await connectToRemoteSession({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: asSessionId("ses_webui"),
      clientId: asClientId("client_webui"),
      createWebSocket: (url) => new TestWebSocket(url),
    });

    expect(result.client.state).toBe("connected");
    expect(result.client.sessionId).toBe(asSessionId("ses_webui"));
    expect(result.identity).toEqual({
      deviceId: "device_webui_test",
      deviceDisplayName: "WebUI Test Daemon",
      projectSlug: "scorel",
    });
    expect(JSON.parse(TestWebSocket.sentMessages[0] ?? "{}")).toMatchObject({
      type: "connect",
      token: "secret-token",
      clientId: "client_webui",
      sessionId: "ses_webui",
      persistentLastSeq: 0,
      streamLastSeq: 0,
    });
  });

  it("can connect to remote identity before a session is selected", async () => {
    const result = await connectToRemoteSession({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      clientId: asClientId("client_webui"),
      createWebSocket: (url) => new TestWebSocket(url),
    });

    expect(result.client.state).toBe("connected");
    expect(result.client.sessionId).toBeNull();
    expect(result.identity).toMatchObject({
      deviceId: "device_webui_test",
      projectSlug: "scorel",
    });
    expect(JSON.parse(TestWebSocket.sentMessages[0] ?? "{}")).toMatchObject({
      type: "connect",
      token: "secret-token",
      clientId: "client_webui",
      persistentLastSeq: 0,
      streamLastSeq: 0,
    });
    expect(JSON.parse(TestWebSocket.sentMessages[0] ?? "{}").sessionId).toBeUndefined();
  });

  it("uses the normalized device link when connecting", async () => {
    let openedUrl = "";
    const result = await connectToRemoteSession({
      url: "127.0.0.1:5050",
      token: "secret-token",
      clientId: asClientId("client_webui"),
      createWebSocket: (url) => {
        openedUrl = url;
        return new TestWebSocket(url);
      },
    });

    expect(result.client.state).toBe("connected");
    expect(openedUrl).toBe("ws://127.0.0.1:5050");
    expect(TestWebSocket.sentMessages).toHaveLength(1);
  });
});
