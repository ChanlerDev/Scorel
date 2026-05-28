import { existsSync, mkdtempSync } from "node:fs";
import { connect, type Socket } from "node:net";
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
  startEmbeddedDaemonSocketServer,
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

  it("adapts embedded daemon protocol to a local socket transport", async () => {
    const daemon = createDaemon();
    const socketPath = join(mkdtempSync(join(tmpdir(), "scorel-embedded-socket-")), "daemon.sock");
    const server = await startEmbeddedDaemonSocketServer({
      daemon,
      socketPath,
      token: "local-secret",
    });
    await daemon.start();
    const clientA = await connectTestSocket(socketPath, "local-secret", "client_a", "ses_socket");
    const clientB = await connectTestSocket(socketPath, "local-secret", "client_b", "ses_socket");
    const clientAMessages: DaemonMessage[] = [];
    const clientBMessages: DaemonMessage[] = [];

    try {
      clientA.onMessage((message) => clientAMessages.push(message));
      clientB.onMessage((message) => clientBMessages.push(message));
      clientA.send({
        type: "create_session",
        requestId: asRequestId("req_create_socket"),
        sessionId: asSessionId("ses_socket"),
        meta: { model: "test-model" },
      });
      await waitForDaemonMessage(
        clientAMessages,
        (message) => "requestId" in message && message.requestId === "req_create_socket",
      );
      clientB.send({
        type: "subscribe_events",
        requestId: asRequestId("req_subscribe_socket"),
        sessionId: asSessionId("ses_socket"),
        lastSeq: asSeq(0),
      });
      clientA.send({
        type: "send_message",
        requestId: asRequestId("req_send_socket"),
        sessionId: asSessionId("ses_socket"),
        content: "hello",
      });

      await expect(waitForDaemonMessage(clientBMessages, (message) => message.type === "event")).resolves.toMatchObject({
        type: "event",
        event: { type: "user_message", sessionId: "ses_socket" },
      });
    } finally {
      clientA.close();
      clientB.close();
      await server.close();
      await daemon.shutdown();
    }
  });
});

type TestSocket = {
  send(message: object): void;
  onMessage(handler: (message: DaemonMessage) => void): void;
  close(): void;
};

const connectTestSocket = async (
  socketPath: string,
  token: string,
  clientId: string,
  sessionId: string,
): Promise<TestSocket> => {
  const socket = connect(socketPath);
  const handlers = new Set<(message: DaemonMessage) => void>();
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line) as DaemonMessage;
      for (const handler of handlers) {
        handler(message);
      }
    }
  });
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write(`${JSON.stringify({ type: "connect", token, clientId, sessionId })}\n`);
  return {
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    onMessage(handler) {
      handlers.add(handler);
    },
    close() {
      socket.end();
      socket.destroy();
    },
  };
};

const waitForDaemonMessage = (
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
