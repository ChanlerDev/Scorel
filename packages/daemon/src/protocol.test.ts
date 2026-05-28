import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScorelRuntime, type RuntimeProvider } from "@scorel/core";
import { asClientId, asDeviceId, asRequestId, asSeq, asSessionId, type DaemonMessage } from "@scorel/protocol";

import { EmbeddedDaemon, createEmbeddedTransport } from "./index.js";

const createDaemon = () =>
  new EmbeddedDaemon({
    sessionsDir: mkdtempSync(join(tmpdir(), "scorel-s0013-")),
    deviceId: asDeviceId("device_test"),
    createRuntime: () => new ScorelRuntime({ provider: emptyProvider }),
    now: () => 1,
    createId: () => "evt_test",
  });

const emptyProvider: RuntimeProvider = {
  streamTurn: async function* () {
    return { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "end_turn" };
  },
};

describe("daemon protocol boundary", () => {
  it("subscribes to a loaded session and resyncs per-session events after lastSeq", async () => {
    const daemon = createDaemon();
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_a"), sessionId: asSessionId("ses_a") });

    transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_a"),
      sessionId: asSessionId("ses_a"),
      meta: { model: "test-model" },
    });
    transport.send({
      type: "subscribe_events",
      requestId: asRequestId("req_subscribe_a"),
      sessionId: asSessionId("ses_a"),
      lastSeq: asSeq(0),
    });

    const subscribeResponse = messages.find(
      (message) => message.type === "response" && message.requestId === "req_subscribe_a",
    );
    expect(subscribeResponse).toMatchObject({
      type: "response",
      requestType: "subscribe_events",
      data: { currentSeq: 0 },
    });
  });

  it("reports daemon status through the protocol", async () => {
    const daemon = createDaemon();
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_status") });

    transport.send({
      type: "get_status",
      requestId: asRequestId("req_status"),
    });

    expect(messages.find((message) => message.type === "response" && message.requestId === "req_status")).toMatchObject({
      type: "response",
      requestType: "get_status",
      data: {
        running: false,
        activeClients: ["client_status"],
        sessionCount: 0,
      },
    });
  });
});
