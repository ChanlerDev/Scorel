import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScorelRuntime, type RuntimeProvider } from "@scorel/core";
import { asClientId, asDeviceId, asRequestId, asSeq, asSessionId, type DaemonMessage } from "@scorel/protocol";

import {
  EmbeddedDaemon,
  createEmbeddedTransport,
  createLocalDaemonState,
  readLocalDaemonState,
  removeLocalDaemonState,
  startLocalDaemonSocketServer,
} from "./index.js";

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

  it("persists and removes local daemon connection state", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "scorel-state-"));

    const state = await createLocalDaemonState({
      stateDir,
      pid: 123,
      socketPath: join(stateDir, "daemon.sock"),
      token: "local-secret",
      startedAt: 1,
    });

    expect(state).toMatchObject({
      pid: 123,
      token: "local-secret",
      startedAt: 1,
    });
    expect(await readLocalDaemonState({ stateDir })).toEqual(state);

    await removeLocalDaemonState({ stateDir });
    expect(existsSync(join(stateDir, "daemon.json"))).toBe(false);
  });

  it("starts a local daemon socket server and validates local token", async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), "scorel-socket-")), "daemon.sock");
    const server = await startLocalDaemonSocketServer({
      socketPath,
      token: "local-secret",
      onClientMessage: (_connection, message) => (message.type === "ping" ? { type: "pong", requestId: message.requestId } : undefined),
    });

    expect(server.socketPath).toBe(socketPath);

    await server.close();
    expect(existsSync(socketPath)).toBe(false);
  });
});
