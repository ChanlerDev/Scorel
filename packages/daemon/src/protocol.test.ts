import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScorelRuntime, type RuntimeProvider } from "@scorel/core";
import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSeq,
  asSessionId,
  type ClientResponse,
  type DaemonMessage,
} from "@scorel/protocol";

import {
  EmbeddedDaemon,
  createEmbeddedTransport,
  createLocalDaemonState,
  daemonStateLiveness,
  markDaemonStopped,
  readLocalDaemonState,
  removeLocalDaemonState,
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
      workDir: "/test-project",
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

  it("persists daemon state with the new schema and removes it on reset", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "scorel-state-"));

    const state = await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "persistent-token",
      cwd: "/Users/chanler/personal/Scorel",
      pid: 4242,
      startedAt: 1700,
      stoppedAt: null,
    });

    expect(state).toEqual({
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "persistent-token",
      cwd: "/Users/chanler/personal/Scorel",
      pid: 4242,
      startedAt: 1700,
      stoppedAt: null,
    });
    expect(await readLocalDaemonState({ stateDir })).toEqual(state);

    await markDaemonStopped({ stateDir, stoppedAt: 1900 });
    expect(await readLocalDaemonState({ stateDir })).toMatchObject({
      stoppedAt: 1900,
      token: "persistent-token",
      pid: 4242,
    });

    await removeLocalDaemonState({ stateDir });
    expect(existsSync(join(stateDir, "daemon.json"))).toBe(false);
    expect(await readLocalDaemonState({ stateDir })).toBeNull();
  });

  it("classifies daemon liveness across pid + stoppedAt combinations", () => {
    const baseline = {
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "t",
      cwd: "/cwd",
      pid: 1,
      startedAt: 1,
    };

    expect(
      daemonStateLiveness({ ...baseline, stoppedAt: null }, { isPidAlive: () => true }),
    ).toBe("running");
    expect(
      daemonStateLiveness({ ...baseline, stoppedAt: null }, { isPidAlive: () => false }),
    ).toBe("orphan");
    expect(
      daemonStateLiveness({ ...baseline, stoppedAt: 100 }, { isPidAlive: () => true }),
    ).toBe("stopped");
    expect(
      daemonStateLiveness({ ...baseline, stoppedAt: 100 }, { isPidAlive: () => false }),
    ).toBe("stopped");
  });

  it("classifies the current process as alive without a custom probe", () => {
    expect(
      daemonStateLiveness({
        host: "127.0.0.1",
        port: 7777,
        wsUrl: "ws://127.0.0.1:7777",
        token: "t",
        cwd: "/cwd",
        pid: process.pid,
        startedAt: 1,
        stoppedAt: null,
      }),
    ).toBe("running");
  });

  it("falls back to persistent JSONL events when websocket resync buffer is cold", async () => {
    const daemon = createDaemon();
    const server = await startEmbeddedDaemonWebSocketServer({
      daemon,
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
    });
    await daemon.start();
    const clientA = await connectTestWebSocket(server.url, "remote-secret", "client_a", "ses_resync");
    const clientB = await connectTestWebSocket(server.url, "remote-secret", "client_b", "ses_resync");
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
    } finally {
      clientA.close();
      clientB.close();
      await server.close();
      await daemon.shutdown();
    }
  });

  it("lazy-loads a cold session lane from disk on resync_events", async () => {
    // Session is created on one daemon instance, then a fresh daemon with
    // the same sessionsDir attaches. The new instance has no in-memory lane
    // for this session id, so persistentLastSeq=0/streamLastSeq=0 must NOT
    // short-circuit on a stale `currentSeq=0`; the daemon must hydrate from
    // disk so the client receives a full_reload with the real history.
    const sessionsDir = mkdtempSync(join(tmpdir(), "scorel-cold-resume-"));
    const sessionId = asSessionId("ses_cold_resume");

    const seedDaemon = createDaemonWithSessionsDir(sessionsDir);
    const seedServer = await startEmbeddedDaemonWebSocketServer({
      daemon: seedDaemon,
      host: "127.0.0.1",
      port: 0,
      token: "cold-secret",
    });
    await seedDaemon.start();
    const seedClient = await connectTestWebSocket(seedServer.url, "cold-secret", "client_seed", sessionId);
    const seedMessages: DaemonMessage[] = [];
    try {
      seedClient.onMessage((message) => seedMessages.push(message));
      seedClient.send({
        type: "create_session",
        requestId: asRequestId("req_cold_create"),
        sessionId,
        meta: { model: "test-model" },
      });
      await waitForDaemonMessage(seedMessages, (message) => "requestId" in message && message.requestId === "req_cold_create");
      seedClient.send({
        type: "send_message",
        requestId: asRequestId("req_cold_send"),
        sessionId,
        content: "hi cold",
      });
      await waitForDaemonMessage(seedMessages, (message) => message.type === "event" && message.event.type === "assistant_message");
    } finally {
      seedClient.close();
      await seedServer.close();
      await seedDaemon.shutdown();
    }

    // New daemon instance, same sessionsDir — simulates `scorel daemon stop &&
    // serve` followed by WebUI opening the historical session.
    const coldDaemon = createDaemonWithSessionsDir(sessionsDir);
    const coldServer = await startEmbeddedDaemonWebSocketServer({
      daemon: coldDaemon,
      host: "127.0.0.1",
      port: 0,
      token: "cold-secret",
    });
    await coldDaemon.start();
    const coldClient = await connectTestWebSocket(coldServer.url, "cold-secret", "client_cold", sessionId);
    const coldMessages: DaemonMessage[] = [];
    try {
      coldClient.onMessage((message) => coldMessages.push(message));
      coldClient.send({
        type: "resync_events",
        requestId: asRequestId("req_cold_resync"),
        sessionId,
        persistentLastSeq: asSeq(0),
        streamLastSeq: asSeq(0),
      });
      await expect(
        waitForDaemonMessage(coldMessages, (message) => "requestId" in message && message.requestId === "req_cold_resync"),
      ).resolves.toMatchObject({
        type: "response",
        requestType: "resync_events",
        data: {
          mode: "full_reload",
          events: expect.arrayContaining([
            expect.objectContaining({ type: "user_message" }),
            expect.objectContaining({ type: "assistant_message" }),
          ]),
        },
      });
    } finally {
      coldClient.close();
      await coldServer.close();
      await coldDaemon.shutdown();
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

  it("cancels a running turn and emits a cancel_requested diagnostic", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "scorel-cancel-running-"));
    let nextId = 0;
    const slowProvider: RuntimeProvider = {
      streamTurn: async function* (input) {
        yield { type: "text_delta", delta: "first" };
        for (let step = 0; step < 100; step += 1) {
          if (input.signal.aborted) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      },
    };
    const daemon = new EmbeddedDaemon({
      sessionsDir,
      deviceId: asDeviceId("device_test"),
      workDir: "/test-project",
      createRuntime: () => new ScorelRuntime({ provider: slowProvider }),
      now: () => 1,
      createId: () => {
        nextId += 1;
        return `evt_cancel_${nextId}`;
      },
    });
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_cancel"), sessionId: asSessionId("ses_cancel") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_cancel"),
      sessionId: asSessionId("ses_cancel"),
      meta: { model: "test-model" },
    });

    const sendPromise = transport.send({
      type: "send_message",
      requestId: asRequestId("req_send_cancel"),
      sessionId: asSessionId("ses_cancel"),
      content: "long running",
    });
    await waitForDaemonMessage(
      messages,
      (message) => message.type === "event" && message.event.type === "text_delta",
    );
    await transport.send({
      type: "cancel",
      requestId: asRequestId("req_cancel_active"),
      sessionId: asSessionId("ses_cancel"),
    });
    await sendPromise;

    const cancelResponse = messages.find(
      (message) => message.type === "response" && message.requestId === "req_cancel_active",
    ) as ClientResponse<"cancel"> | undefined;
    expect(cancelResponse).toBeDefined();
    expect(cancelResponse).toMatchObject({
      type: "response",
      requestType: "cancel",
      data: { sessionId: "ses_cancel", cancelled: true },
    });
    const log = readFileSync(join(sessionsDir, "ses_cancel.log"), "utf8");
    expect(log).toContain("event=cancel_requested");
    expect(log).toContain("cancelled=true");
    await daemon.shutdown();
  });

  it("returns cancelled=false when there is no running turn", async () => {
    const daemon = createDaemon();
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_idle"), sessionId: asSessionId("ses_idle") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_idle"),
      sessionId: asSessionId("ses_idle"),
      meta: {},
    });

    await transport.send({
      type: "cancel",
      requestId: asRequestId("req_cancel_idle"),
      sessionId: asSessionId("ses_idle"),
    });

    const response = messages.find(
      (message) => message.type === "response" && message.requestId === "req_cancel_idle",
    );
    expect(response).toMatchObject({
      type: "response",
      requestType: "cancel",
      data: { sessionId: "ses_idle", cancelled: false },
    });
    await daemon.shutdown();
  });

  it("lists all sessions, filters by projectSlug, and clamps with limit", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "scorel-list-sessions-"));
    let nextId = 0;
    const daemon = new EmbeddedDaemon({
      sessionsDir,
      deviceId: asDeviceId("device_test"),
      workDir: "/Users/test/repo-alpha",
      createRuntime: () => new ScorelRuntime({ provider: emptyProvider }),
      now: () => 100 + nextId,
      createId: () => {
        nextId += 1;
        return `evt_list_${nextId}`;
      },
    });
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_list") });

    for (const sessionId of ["ses_alpha_1", "ses_alpha_2", "ses_alpha_3"]) {
      await transport.send({
        type: "create_session",
        requestId: asRequestId(`req_create_${sessionId}`),
        sessionId: asSessionId(sessionId),
        meta: { model: "test-model" },
      });
    }

    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_all"),
    });
    const allResponse = messages.find(
      (message) => message.type === "response" && message.requestId === "req_list_all",
    ) as ClientResponse<"list_sessions"> | undefined;
    expect(allResponse?.data.sessions.map((session) => String(session.sessionId)).sort()).toEqual([
      "ses_alpha_1",
      "ses_alpha_2",
      "ses_alpha_3",
    ]);
    expect(allResponse?.data.sessions.every((session) => session.projectSlug === "Users-test-repo-alpha")).toBe(true);

    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_filter_match"),
      projectSlug: "Users-test-repo-alpha",
    });
    const filtered = messages.find(
      (message) => message.type === "response" && message.requestId === "req_list_filter_match",
    ) as ClientResponse<"list_sessions"> | undefined;
    expect(filtered?.data.sessions).toHaveLength(3);

    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_filter_miss"),
      projectSlug: "non-existent-slug",
    });
    const empty = messages.find(
      (message) => message.type === "response" && message.requestId === "req_list_filter_miss",
    ) as ClientResponse<"list_sessions"> | undefined;
    expect(empty?.data.sessions).toEqual([]);

    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_limit"),
      limit: 2,
    });
    const limited = messages.find(
      (message) => message.type === "response" && message.requestId === "req_list_limit",
    ) as ClientResponse<"list_sessions"> | undefined;
    expect(limited?.data.sessions).toHaveLength(2);
    await daemon.shutdown();
  });

  it("aggregates DaemonProjectSummary across daemon's sessions", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "scorel-list-projects-"));
    // Pre-populate with a session header from a different slug so aggregator
    // sees a second project even though daemon's own workDir is alpha.
    const otherJsonl = join(sessionsDir, "ses_beta.jsonl");
    const headerLine = JSON.stringify({
      version: 1,
      sessionId: "ses_beta",
      deviceId: "device_test",
      createdAt: 50,
      meta: {
        projectSlug: "Users-test-repo-beta",
        workDirHint: "/Users/test/repo-beta",
        updatedAt: 75,
      },
    });
    const eventLine = JSON.stringify({
      type: "user_message",
      id: "evt_beta_1",
      parentId: null,
      seq: 1,
      sessionId: "ses_beta",
      clientId: "client_seed",
      ts: 51,
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(otherJsonl, `${headerLine}\n${eventLine}\n`, "utf8");

    let nextId = 0;
    const daemon = new EmbeddedDaemon({
      sessionsDir,
      deviceId: asDeviceId("device_test"),
      workDir: "/Users/test/repo-alpha",
      createRuntime: () => new ScorelRuntime({ provider: emptyProvider }),
      now: () => 200,
      createId: () => {
        nextId += 1;
        return `evt_proj_${nextId}`;
      },
    });
    const transport = createEmbeddedTransport(daemon);
    const messages: DaemonMessage[] = [];

    await daemon.start();
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_proj") });

    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create_alpha"),
      sessionId: asSessionId("ses_alpha"),
      meta: { model: "test-model" },
    });

    await transport.send({
      type: "list_projects",
      requestId: asRequestId("req_list_projects"),
    });
    const response = messages.find(
      (message) => message.type === "response" && message.requestId === "req_list_projects",
    ) as ClientResponse<"list_projects"> | undefined;
    expect(response).toBeDefined();
    const projects = response!.data.projects;
    const slugs = projects.map((project) => project.projectSlug).sort();
    expect(slugs).toEqual(["Users-test-repo-alpha", "Users-test-repo-beta"]);
    const alpha = projects.find((project) => project.projectSlug === "Users-test-repo-alpha");
    const beta = projects.find((project) => project.projectSlug === "Users-test-repo-beta");
    expect(alpha).toMatchObject({
      displayName: "repo-alpha",
      workDirHint: "/Users/test/repo-alpha",
      sessionCount: 1,
    });
    expect(beta).toMatchObject({
      displayName: "repo-beta",
      workDirHint: "/Users/test/repo-beta",
      sessionCount: 1,
    });
    await daemon.shutdown();
  });
});

type TestWebSocket = {
  send(message: object): void;
  onMessage(handler: (message: DaemonMessage) => void): void;
  close(): void;
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
