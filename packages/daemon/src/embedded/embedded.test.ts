import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  ScorelRuntime,
  type RuntimeProvider,
} from "@scorel/core";
import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSeq,
  asSessionId,
  type DaemonMessage,
  type ScorelEvent,
  type ScorelMessage,
} from "@scorel/protocol";

import { EmbeddedDaemon, createEmbeddedTransport } from "../index.js";

const userMessage = (text: string): ScorelMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

const assistantMessage = (text: string): ScorelMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

describe("embedded daemon + client", () => {
  it("persists a client message, runs runtime, and broadcasts ordered events to multiple clients", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-daemon-"));
    const sessionId = asSessionId("ses_embedded");
    const provider: RuntimeProvider = {
      streamTurn: async function* ({ context }) {
        expect(context).toEqual([userMessage("hello")]);
        yield { type: "text_delta", delta: "he" };
        yield { type: "text_delta", delta: "llo" };
        return assistantMessage("hello");
      },
    };
    const daemon = new EmbeddedDaemon({
      sessionsDir,
      deviceId: asDeviceId("device_test"),
      createRuntime: () => new ScorelRuntime({ provider }),
      now: () => 1_000,
      createId: (() => {
        const ids = ["evt_user", "evt_assistant"];
        return () => ids.shift() ?? "evt_extra";
      })(),
    });
    const clientAEvents: ScorelEvent[] = [];
    const clientBEvents: ScorelEvent[] = [];
    const transportA = createEmbeddedTransport(daemon);
    const transportB = createEmbeddedTransport(daemon);
    let lastSeq = asSeq(0);
    let persistentIds: string[] = [];
    let activeLeaf: string | null = null;

    transportA.onMessage((message) => {
      if (message.type === "event") {
        clientAEvents.push(message.event);
        lastSeq = message.event.seq;
        if ("id" in message.event) {
          persistentIds.push(String(message.event.id));
          activeLeaf = String(message.event.id);
        }
      }
    });
    transportB.onMessage((message) => {
      if (message.type === "event") {
        clientBEvents.push(message.event);
      }
    });

    await daemon.start();
    const createResponse = waitForResponse(transportA, "req_create");
    await transportA.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId,
      meta: { model: "fake" },
    });
    await expect(createResponse).resolves.toMatchObject({ type: "response", requestType: "create_session" });
    await transportA.connect({ clientId: asClientId("client_a"), sessionId });
    await transportB.connect({ clientId: asClientId("client_b"), sessionId });

    const sendResponse = waitForResponse(transportA, "req_send");
    await transportA.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId,
      content: "hello",
    });
    await expect(sendResponse).resolves.toMatchObject({
      type: "response",
      requestType: "send_message",
      data: {
        userEventId: "evt_user",
        assistantEventId: "evt_assistant",
      },
    });

    expect(clientAEvents.map((event) => event.type)).toEqual([
      "user_message",
      "turn_start",
      "message_start",
      "text_delta",
      "text_delta",
      "assistant_message",
      "turn_end",
    ]);
    expect(clientBEvents).toEqual(clientAEvents);
    expect(lastSeq).toBe(7);
    expect(persistentIds).toEqual(["evt_user", "evt_assistant"]);
    expect(activeLeaf).toBe("evt_assistant");

    const jsonl = await readFile(join(sessionsDir, "ses_embedded.jsonl"), "utf8");
    const persistedLines = jsonl.trim().split("\n").map((line) => JSON.parse(line));
    expect(persistedLines.map((line) => line.type ?? "header")).toEqual(["header", "user_message", "assistant_message"]);
    expect(persistedLines[1]).toMatchObject({ id: "evt_user", seq: 1, parentId: null });
    expect(persistedLines[2]).toMatchObject({ id: "evt_assistant", seq: 6, parentId: "evt_user" });

    const resyncResponse = waitForResponse(transportB, "req_resync");
    await transportB.send({
      type: "resync_events",
      requestId: asRequestId("req_resync"),
      sessionId,
      fromSeq: asSeq(1),
    });
    const resyncMessage = await resyncResponse;
    expect(resyncMessage).toMatchObject({
      type: "response",
      requestType: "resync_events",
      data: { throughSeq: 7 },
    });
    if (resyncMessage.type !== "response" || resyncMessage.requestType !== "resync_events") {
      throw new Error("Expected resync response");
    }
    expect(resyncMessage.data.events.map((event) => event.type)).toEqual([
      "turn_start",
      "message_start",
      "text_delta",
      "text_delta",
      "assistant_message",
      "turn_end",
    ]);
  });
});

const waitForResponse = (transport: ReturnType<typeof createEmbeddedTransport>, requestId: string): Promise<DaemonMessage> =>
  new Promise((resolve) => {
    transport.onMessage((message) => {
      if ("requestId" in message && message.requestId === requestId) {
        resolve(message);
      }
    });
  });
