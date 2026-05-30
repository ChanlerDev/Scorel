import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
  startEmbeddedDaemonWebSocketServer,
  startRemoteDaemonWebSocketServer,
} from "./index.js";

const createDaemon = () =>
  createDaemonWithSessionsDir(mkdtempSync(join(tmpdir(), "scorel-s0013-")));

const createDaemonWithSessionsDir = (sessionsDir: string) =>
  {
    let nextId = 0;
    return new EmbeddedDaemon({
      sessionsDir,
      deviceId: asDeviceId("device_test"),
      deviceDisplayName: "Test Device",
      projectSlug: "test-project",
      createRuntime: () => new ScorelRuntime({ provider: emptyProvider }),
      now: () => 1,
      createId: () => {
        nextId += 1;
        return `evt_test_${nextId}`;
      },
    });
  };

const emptyProvider: RuntimeProvider = {
  streamTurn: async function* () {
    return { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
  },
};

describe("daemon protocol boundary", () => {
  it("writes diagnostics beside the session file for send and resync", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "scorel-diagnostics-"));
    const daemon = createDaemonWithSessionsDir(sessionsDir);
    const transport = createEmbeddedTransport(daemon);

    await daemon.start();
    await transport.connect({ clientId: asClientId("client_diag"), sessionId: asSessionId("ses_diag") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_diag"),
      sessionId: asSessionId("ses_diag"),
      meta: { model: "test-model" },
    });
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send_diag"),
      sessionId: asSessionId("ses_diag"),
      content: "hello",
    });
    await transport.send({
      type: "resync_events",
      requestId: asRequestId("req_resync_diag"),
      sessionId: asSessionId("ses_diag"),
      persistentLastSeq: asSeq(1),
      streamLastSeq: asSeq(1),
    });

    const log = readFileSync(join(sessionsDir, "ses_diag.log"), "utf8");
    expect(log).toContain("event=session_created");
    expect(log).toContain("event=send_message_started");
    expect(log).toContain("event=assistant_result");
    expect(log).toContain("event=send_message_finished");
    expect(log).toContain("event=resync_events");
    expect(log).toContain("mode=stream_resume");
    expect(log).toContain("clientId=client_diag");
  });

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

  it("lists loaded sessions with stable summaries", async () => {
    const daemon = createDaemon();
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_list") });

    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_list_a"),
      sessionId: asSessionId("ses_list_a"),
      meta: { title: "Alpha session", model: "test-model", createdAt: 10, updatedAt: 20 },
    });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_list_b"),
      sessionId: asSessionId("ses_list_b"),
      meta: { title: "Beta session", model: "test-model", createdAt: 30 },
    });
    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_sessions"),
    });

    expect(messages.find((message) => message.type === "response" && message.requestId === "req_list_sessions")).toMatchObject({
      type: "response",
      requestType: "list_sessions",
      data: {
        sessions: [
          {
            sessionId: "ses_list_a",
            title: "Alpha session",
            model: "test-model",
            updatedAt: 20,
            currentSeq: 0,
          },
          {
            sessionId: "ses_list_b",
            title: "Beta session",
            model: "test-model",
            updatedAt: 30,
            currentSeq: 0,
          },
        ],
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

  it("falls back to persistent JSONL events when socket resync buffer is cold", async () => {
    const daemon = createDaemon();
    const socketPath = join(mkdtempSync(join(tmpdir(), "scorel-resync-socket-")), "daemon.sock");
    const server = await startEmbeddedDaemonSocketServer({
      daemon,
      socketPath,
      token: "local-secret",
    });
    await daemon.start();
    const clientA = await connectTestSocket(socketPath, "local-secret", "client_a", "ses_resync");
    const clientB = await connectTestSocket(socketPath, "local-secret", "client_b", "ses_resync");
    const clientAMessages: DaemonMessage[] = [];
    const clientBMessages: DaemonMessage[] = [];

    try {
      clientA.onMessage((message) => clientAMessages.push(message));
      clientB.onMessage((message) => clientBMessages.push(message));
      clientA.send({
        type: "create_session",
        requestId: asRequestId("req_create_resync"),
        sessionId: asSessionId("ses_resync"),
        meta: { model: "test-model" },
      });
      await waitForDaemonMessage(clientAMessages, (message) => "requestId" in message && message.requestId === "req_create_resync");
      clientA.send({
        type: "send_message",
        requestId: asRequestId("req_send_resync"),
        sessionId: asSessionId("ses_resync"),
        content: "hello",
      });
      await waitForDaemonMessage(clientAMessages, (message) => message.type === "event" && message.event.type === "assistant_message");
      daemon.releaseSessionEventBuffer(asSessionId("ses_resync"));

      clientB.send({
        type: "resync_events",
        requestId: asRequestId("req_resync_cold"),
        sessionId: asSessionId("ses_resync"),
        fromSeq: asSeq(1),
      });

      await expect(
        waitForDaemonMessage(clientBMessages, (message) => "requestId" in message && message.requestId === "req_resync_cold"),
      ).resolves.toMatchObject({
        type: "response",
        requestType: "resync_events",
        data: {
          events: expect.arrayContaining([expect.objectContaining({ type: "assistant_message" })]),
          throughSeq: 4,
          mode: "persistent_fallback",
        },
      });

      const seenBeforeLive = clientBMessages.length;
      clientA.send({
        type: "send_message",
        requestId: asRequestId("req_send_after_fallback"),
        sessionId: asSessionId("ses_resync"),
        content: "after fallback",
      });
      await expect(
        waitForDaemonMessage(
          clientBMessages,
          (message) =>
            clientBMessages.indexOf(message) >= seenBeforeLive &&
            message.type === "event" &&
            Number(message.event.seq) > 4,
        ),
      ).resolves.toMatchObject({ type: "event" });
    } finally {
      clientA.close();
      clientB.close();
      await server.close();
      await daemon.shutdown();
    }
  });

  it("does not treat a non-contiguous persistent-only buffer as stream resume", async () => {
    const daemon = createDaemon();
    const socketPath = join(mkdtempSync(join(tmpdir(), "scorel-resync-gap-")), "daemon.sock");
    const server = await startEmbeddedDaemonSocketServer({
      daemon,
      socketPath,
      token: "local-secret",
    });
    await daemon.start();
    const clientA = await connectTestSocket(socketPath, "local-secret", "client_a", "ses_gap");
    const clientB = await connectTestSocket(socketPath, "local-secret", "client_b", "ses_gap");
    const clientAMessages: DaemonMessage[] = [];
    const clientBMessages: DaemonMessage[] = [];

    try {
      clientA.onMessage((message) => clientAMessages.push(message));
      clientB.onMessage((message) => clientBMessages.push(message));
      clientA.send({
        type: "create_session",
        requestId: asRequestId("req_create_gap"),
        sessionId: asSessionId("ses_gap"),
        meta: { model: "test-model" },
      });
      await waitForDaemonMessage(clientAMessages, (message) => "requestId" in message && message.requestId === "req_create_gap");
      clientA.send({
        type: "send_message",
        requestId: asRequestId("req_send_gap"),
        sessionId: asSessionId("ses_gap"),
        content: "hello",
      });
      await waitForDaemonMessage(clientAMessages, (message) => message.type === "event" && message.event.type === "assistant_message");
      daemon.releaseSessionEventBuffer(asSessionId("ses_gap"));

      clientB.send({
        type: "load_session",
        requestId: asRequestId("req_load_gap"),
        sessionId: asSessionId("ses_gap"),
      });
      await waitForDaemonMessage(clientBMessages, (message) => "requestId" in message && message.requestId === "req_load_gap");
      clientB.send({
        type: "resync_events",
        requestId: asRequestId("req_resync_gap"),
        sessionId: asSessionId("ses_gap"),
        persistentLastSeq: asSeq(1),
        streamLastSeq: asSeq(2),
      });

      await expect(
        waitForDaemonMessage(clientBMessages, (message) => "requestId" in message && message.requestId === "req_resync_gap"),
      ).resolves.toMatchObject({
        type: "response",
        requestType: "resync_events",
        data: {
          mode: "persistent_fallback",
          throughSeq: 4,
          gapFromSeq: 3,
          gapToSeq: 5,
          events: [expect.objectContaining({ type: "assistant_message", seq: 4 })],
        },
      });
    } finally {
      clientA.close();
      clientB.close();
      await server.close();
      await daemon.shutdown();
    }
  });

  it("starts a remote daemon WebSocket server and validates remote token", async () => {
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: (_connection, message) => (message.type === "ping" ? { type: "pong", requestId: message.requestId } : undefined),
    });
    const invalid = await connectTestWebSocket(server.url, "wrong-secret", "client_bad", "ses_ws_bad");
    const valid = await connectTestWebSocket(server.url, "remote-secret", "client_good", "ses_ws_good");
    const invalidMessages: DaemonMessage[] = [];
    const validMessages: DaemonMessage[] = [];

    try {
      invalid.onMessage((message) => invalidMessages.push(message));
      valid.onMessage((message) => validMessages.push(message));

      await expect(waitForDaemonMessage(invalidMessages, (message) => message.type === "error")).resolves.toMatchObject({
        type: "error",
        code: "auth_failed",
        message: "invalid remote token",
      });
      await expect(waitForDaemonMessage(validMessages, (message) => message.type === "connected")).resolves.toMatchObject({
        type: "connected",
        clientId: "client_good",
        sessionId: "ses_ws_good",
      });

      valid.send({ type: "ping", requestId: asRequestId("req_ws_ping") });
      await expect(waitForDaemonMessage(validMessages, (message) => message.type === "pong")).resolves.toMatchObject({
        type: "pong",
        requestId: "req_ws_ping",
      });
    } finally {
      invalid.close();
      valid.close();
      await server.close();
    }
  });

  it("adapts embedded daemon protocol to a remote WebSocket transport", async () => {
    const daemon = createDaemon();
    const server = await startEmbeddedDaemonWebSocketServer({
      daemon,
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
    });
    await daemon.start();
    const clientA = await connectTestWebSocket(server.url, "remote-secret", "client_a", "ses_remote");
    const clientB = await connectTestWebSocket(server.url, "remote-secret", "client_b", "ses_remote");
    const clientAMessages: DaemonMessage[] = [];
    const clientBMessages: DaemonMessage[] = [];

    try {
      clientA.onMessage((message) => clientAMessages.push(message));
      clientB.onMessage((message) => clientBMessages.push(message));
      clientA.send({
        type: "create_session",
        requestId: asRequestId("req_create_remote"),
        sessionId: asSessionId("ses_remote"),
        meta: { model: "test-model" },
      });
      await waitForDaemonMessage(clientAMessages, (message) => "requestId" in message && message.requestId === "req_create_remote");
      clientB.send({
        type: "subscribe_events",
        requestId: asRequestId("req_subscribe_remote"),
        sessionId: asSessionId("ses_remote"),
        lastSeq: asSeq(0),
      });
      clientA.send({
        type: "send_message",
        requestId: asRequestId("req_send_remote"),
        sessionId: asSessionId("ses_remote"),
        content: "hello",
      });

      await expect(waitForDaemonMessage(clientBMessages, (message) => message.type === "event")).resolves.toMatchObject({
        type: "event",
        event: { type: "user_message", sessionId: "ses_remote" },
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

type TestWebSocket = {
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

const connectTestWebSocket = async (
  url: string,
  token: string,
  clientId: string,
  sessionId: string,
): Promise<TestWebSocket> => {
  const socket = new WebSocket(url);
  const handlers = new Set<(message: DaemonMessage) => void>();
  const buffered: DaemonMessage[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as DaemonMessage;
    buffered.push(message);
    for (const handler of handlers) {
      handler(message);
    }
  });
  await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
  socket.send(JSON.stringify({ type: "connect", token, clientId, sessionId }));
  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    onMessage(handler) {
      handlers.add(handler);
      for (const message of buffered) {
        handler(message);
      }
    },
    close() {
      socket.close();
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
