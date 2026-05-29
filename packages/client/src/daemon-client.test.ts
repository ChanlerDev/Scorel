import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import {
  asClientId,
  asEventId,
  asRequestId,
  asSeq,
  asSessionId,
  type ClientMessage,
  type ConnectParams,
  type ConnectResult,
  type DaemonMessage,
  type DaemonTransport,
} from "@scorel/protocol";

import { DaemonClient } from "./index.js";
import { WsTransport } from "./index.js";

class MemoryTransport implements DaemonTransport {
  readonly sent: ClientMessage[] = [];
  #handler: ((message: DaemonMessage) => void) | undefined;

  async connect(_params: ConnectParams): Promise<ConnectResult> {
    return { clientId: asClientId("client_test"), currentSeq: asSeq(0) };
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: DaemonMessage) => void) {
    this.#handler = handler;
    return () => {
      this.#handler = undefined;
    };
  }

  close(): void {
    this.#handler = undefined;
  }

  emit(message: DaemonMessage): void {
    this.#handler?.(message);
  }
}

describe("DaemonClient", () => {
  it("sends requests, resolves responses, and projects local event state", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_1"),
    });
    const seen: string[] = [];

    await client.connect(asSessionId("ses_1"));
    client.subscribe((event) => seen.push(event.type));
    const pending = client.sendMessage("hello");

    expect(transport.sent.at(-1)).toMatchObject({
      type: "send_message",
      requestId: "req_1",
      sessionId: "ses_1",
      content: "hello",
    });

    transport.emit({
      type: "event",
      event: {
        type: "text_delta",
        seq: asSeq(1),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("client_test"),
        ts: 1,
        eventId: asEventId("evt_assistant"),
        delta: "hi",
      },
    });
    transport.emit({
      type: "event",
      event: {
        type: "assistant_message",
        id: asEventId("evt_assistant"),
        parentId: asEventId("evt_user"),
        seq: asSeq(2),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("client_test"),
        ts: 2,
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
    });
    transport.emit({
      type: "response",
      requestType: "send_message",
      requestId: asRequestId("req_1"),
      ok: true,
      data: {
        userEventId: asEventId("evt_user"),
        assistantEventId: asEventId("evt_assistant"),
      },
    });

    await expect(pending).resolves.toEqual({
      userEventId: "evt_user",
      assistantEventId: "evt_assistant",
    });
    expect(seen).toEqual(["text_delta", "assistant_message"]);
    expect(client.lastSeq).toBe(2);
    expect(client.getEvents().map((event) => event.id)).toEqual(["evt_assistant"]);
    expect(client.getActiveLeaf()).toBe("evt_assistant");
  });
});

describe("WsTransport", () => {
  it("connects to a real WebSocket daemon endpoint and exchanges protocol messages", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    const messages: DaemonMessage[] = [];
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("missing server address");
    }
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as { type: string; clientId?: string; token?: string; requestId?: string };
        if (message.type === "connect" && message.token === "remote-secret") {
          socket.send(JSON.stringify({ type: "connected", clientId: message.clientId, sessionId: "ses_ws", currentSeq: 0 }));
        }
        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", requestId: message.requestId }));
        }
      });
    });
    const transport = new WsTransport({ url: `ws://127.0.0.1:${address.port}`, token: "remote-secret" });

    try {
      transport.onMessage((message) => messages.push(message));
      await transport.connect({ clientId: asClientId("client_ws"), sessionId: asSessionId("ses_ws") });
      const pong = waitForMessage(messages, (message) => message.type === "pong");
      transport.send({ type: "ping", requestId: asRequestId("req_ping") });

      await expect(pong).resolves.toEqual({ type: "pong", requestId: "req_ping" });
    } finally {
      transport.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

const waitForMessage = (
  messages: DaemonMessage[],
  predicate: (message: DaemonMessage) => boolean,
): Promise<DaemonMessage> =>
  new Promise((resolve) => {
    const interval = setInterval(() => {
      const message = messages.find(predicate);
      if (!message) {
        return;
      }
      clearInterval(interval);
      resolve(message);
    }, 1);
  });
