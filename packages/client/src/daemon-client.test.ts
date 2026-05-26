import { describe, expect, it } from "vitest";

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
