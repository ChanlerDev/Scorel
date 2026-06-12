import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

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
  ScorelHost,
  createEmbeddedTransport,
  createLocalDaemonState,
  daemonStateLiveness,
  markDaemonStopped,
  readLocalDaemonState,
  removeLocalDaemonState,
  startRemoteDaemonWebSocketServer,
  startScorelHostWebSocketServer,
} from "./index.js";

const provider: RuntimeProvider = {
  streamTurn: async function* () {
    return { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
  },
};

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-protocol-"));
  const sessionsDir = join(root, "sessions");
  await mkdir(sessionsDir);
  const host = new ScorelHost({
    sessionsDir,
    projectsPath: join(root, "projects.json"),
    deviceId: asDeviceId("device_test"),
    deviceDisplayName: "Test Device",
    createRuntime: async () => new ScorelRuntime({ provider }),
    now: () => 100,
  });
  await host.start();
  return { root, sessionsDir, host, transport: createEmbeddedTransport(host) };
};

describe("daemon protocol boundary", () => {
  it("supports registry wire operations and project-filtered session listing", async () => {
    const { root, host, transport } = await fixture();
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    await Promise.all([mkdir(repoA), mkdir(repoB)]);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_test") });

    await transport.send({ type: "register_project", requestId: asRequestId("req_reg_a"), workDir: repoA });
    await transport.send({ type: "register_project", requestId: asRequestId("req_reg_b"), workDir: repoB });
    const projects = await host.listProjects();
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_a"),
      meta: { projectId: projects[0]!.projectId },
    });
    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_sessions"),
      projectId: projects[0]!.projectId,
    });
    await transport.send({ type: "list_projects", requestId: asRequestId("req_projects") });

    const listed = response(messages, "req_sessions") as ClientResponse<"list_sessions">;
    expect(listed.data.sessions).toEqual([
      expect.objectContaining({ sessionId: "ses_a", projectId: projects[0]!.projectId }),
    ]);
    const registry = response(messages, "req_projects") as ClientResponse<"list_projects">;
    expect(registry.data.projects).toEqual(projects);
    expect(registry.data.projects[0]).toHaveProperty("createdAt");
    expect(registry.data.projects[0]).not.toHaveProperty("sessionCount");
  });

  it("maps remove conflict and filesystem failures to explicit wire errors", async () => {
    const { root, host, transport } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_owned"),
      meta: { projectId: project.projectId },
    });
    await transport.send({ type: "remove_project", requestId: asRequestId("req_remove"), projectId: project.projectId });
    await transport.send({ type: "list_directories", requestId: asRequestId("req_fs"), path: join(root, "missing") });

    expect(response(messages, "req_remove")).toMatchObject({ type: "error", code: "project_has_sessions" });
    expect(response(messages, "req_fs")).toMatchObject({ type: "error", code: "filesystem_error" });
  });

  it("removes a project without sessions through the wire contract", async () => {
    const { root, sessionsDir, host, transport } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_test") });

    await transport.send({ type: "remove_project", requestId: asRequestId("req_remove"), projectId: project.projectId });

    expect(response(messages, "req_remove")).toMatchObject({
      type: "response",
      requestType: "remove_project",
      data: { projectId: project.projectId, removed: true },
    });
    expect(await host.listProjects()).toEqual([]);
    expect(await readFile(join(sessionsDir, "host.log"), "utf8")).toContain(`workDir=${project.workDir}`);
  });

  it("lists only direct child directories in stable order with canonical parent paths", async () => {
    const { root, host } = await fixture();
    const browse = join(root, "browse");
    await mkdir(join(browse, "zeta"), { recursive: true });
    await mkdir(join(browse, "alpha"));
    await writeFile(join(browse, "file.txt"), "ignore");

    const listing = await host.listDirectories(browse);

    const canonicalBrowse = await realpath(browse);
    expect(listing.path).toBe(canonicalBrowse);
    expect(listing.parentPath).toBe(await realpath(root));
    expect(listing.entries).toEqual([
      { name: "alpha", path: join(canonicalBrowse, "alpha"), kind: "directory" },
      { name: "zeta", path: join(canonicalBrowse, "zeta"), kind: "directory" },
    ]);
  });

  it("uses home as the default directory browser starting point", async () => {
    const { host } = await fixture();
    expect((await host.listDirectories()).path).toBe(await realpath(homedir()));
  });

  it("writes project and runtime diagnostics with project identity and workDir", async () => {
    const { root, sessionsDir, host, transport } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    await transport.connect({ clientId: asClientId("client_diag") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_diag"),
      meta: { projectId: project.projectId },
    });

    const hostLog = await readFile(join(sessionsDir, "host.log"), "utf8");
    const sessionLog = await readFile(join(sessionsDir, "ses_diag.log"), "utf8");
    expect(hostLog).toContain("event=project_registered");
    expect(sessionLog).toContain("event=project_resolved");
    expect(sessionLog).toContain("event=runtime_created");
    expect(sessionLog).toContain(`projectId=${project.projectId}`);
    expect(sessionLog).toContain(`workDir=${project.workDir}`);
  });

  it("persists local daemon state without startup cwd and marks stopped state", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-state-"));
    const state = await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "token",
      pid: 4242,
      startedAt: 1700,
      stoppedAt: null,
    });
    expect(state).not.toHaveProperty("cwd");
    expect(await readLocalDaemonState({ stateDir })).toEqual(state);
    await markDaemonStopped({ stateDir, stoppedAt: 1900 });
    expect(await readLocalDaemonState({ stateDir })).toMatchObject({ stoppedAt: 1900 });
    await removeLocalDaemonState({ stateDir });
    expect(existsSync(join(stateDir, "daemon.json"))).toBe(false);
  });

  it("classifies daemon state liveness", () => {
    const state = {
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "token",
      pid: 1,
      startedAt: 1,
      stoppedAt: null,
    };
    expect(daemonStateLiveness(state, { isPidAlive: () => true })).toBe("running");
    expect(daemonStateLiveness(state, { isPidAlive: () => false })).toBe("orphan");
    expect(daemonStateLiveness({ ...state, stoppedAt: 2 }, { isPidAlive: () => true })).toBe("stopped");
  });

  it("reports status and cancels an idle session", async () => {
    const { root, host, transport } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_status") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_idle"),
      meta: { projectId: project.projectId },
    });
    await transport.send({ type: "get_status", requestId: asRequestId("req_status") });
    await transport.send({ type: "cancel", requestId: asRequestId("req_cancel"), sessionId: asSessionId("ses_idle") });

    expect(response(messages, "req_status")).toMatchObject({
      type: "response",
      requestType: "get_status",
      data: { activeClients: ["client_status"], sessionCount: 1 },
    });
    expect(response(messages, "req_cancel")).toMatchObject({
      type: "response",
      requestType: "cancel",
      data: { sessionId: "ses_idle", cancelled: false },
    });
  });

  it("rewrites queue state through the wire contract", async () => {
    const { root, sessionsDir, host, transport } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_queue") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_queue"),
      meta: { projectId: project.projectId },
    });
    const item = {
      id: "queue_item_1",
      content: [{ type: "text" as const, text: "next" }],
      createdAt: 1,
      updatedAt: 2,
      clientId: asClientId("client_queue"),
    };

    await transport.send({
      type: "rewrite_queue",
      requestId: asRequestId("req_queue"),
      sessionId: asSessionId("ses_queue"),
      queue: "follow_up",
      items: [item],
    });

    expect(response(messages, "req_queue")).toMatchObject({
      type: "response",
      requestType: "rewrite_queue",
      data: { sessionId: "ses_queue", queue: "follow_up", items: [item] },
    });
    const events = (await readFile(join(sessionsDir, "ses_queue.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; queue?: string; items?: unknown[] });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "queue_update",
        queue: "follow_up",
        items: [expect.objectContaining({ id: "queue_item_1" })],
      }),
    );
  });

  it("falls back to persistent events after the live resync buffer is released", async () => {
    const { root, host, transport } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_resync"), sessionId: asSessionId("ses_resync") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_resync"),
      meta: { projectId: project.projectId },
    });
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_resync"),
      content: "hello",
    });
    host.releaseSessionEventBuffer(asSessionId("ses_resync"));
    await transport.send({
      type: "resync_events",
      requestId: asRequestId("req_resync"),
      sessionId: asSessionId("ses_resync"),
      persistentLastSeq: asSeq(4),
      streamLastSeq: asSeq(4),
    });

    expect(response(messages, "req_resync")).toMatchObject({
      type: "response",
      requestType: "resync_events",
      data: {
        mode: "persistent_fallback",
        events: [expect.objectContaining({ type: "assistant_message" })],
      },
    });
  });

  it("broadcasts streaming thinking deltas before the final assistant message", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-thinking-protocol-"));
    const sessionsDir = join(root, "sessions");
    await mkdir(sessionsDir);
    const thinkingProvider: RuntimeProvider = {
      streamTurn: async function* () {
        yield { type: "thinking_delta", delta: "inspect" };
        yield { type: "text_delta", delta: "done" };
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath: join(root, "projects.json"),
      deviceId: asDeviceId("device_test"),
      createRuntime: async () => new ScorelRuntime({ provider: thinkingProvider }),
      now: () => 100,
    });
    await host.start();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    const messages: DaemonMessage[] = [];
    transport.onMessage((message) => messages.push(message));
    await transport.connect({ clientId: asClientId("client_thinking"), sessionId: asSessionId("ses_thinking") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_thinking_create"),
      sessionId: asSessionId("ses_thinking"),
      meta: { projectId: project.projectId },
    });
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_thinking_send"),
      sessionId: asSessionId("ses_thinking"),
      content: "show thinking",
    });

    await waitForMessage(messages, (message) => message.type === "event" && message.event.type === "thinking_delta");
    expect(messages.find((message) => message.type === "event" && message.event.type === "thinking_delta")).toMatchObject({
      type: "event",
      event: {
        type: "thinking_delta",
        delta: "inspect",
      },
    });
    expect(messages.find((message) => message.type === "event" && message.event.type === "text_delta")).toMatchObject({
      type: "event",
      event: {
        type: "text_delta",
        delta: "done",
      },
    });
    await waitForMessage(messages, (message) => "requestId" in message && message.requestId === "req_thinking_send");
    expect(response(messages, "req_thinking_send")).toMatchObject({
      type: "response",
      requestType: "send_message",
    });
  });

  it("serves Host protocol over WebSocket with a device-only handshake", async () => {
    const { root, host } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const server = await startScorelHostWebSocketServer({
      hostService: host,
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
    });
    const client = await connectTestWebSocket(server.url, "remote-secret", "client_ws");
    try {
      await expect(client.waitFor((message) => message.type === "connected")).resolves.toMatchObject({
        type: "connected",
        clientId: "client_ws",
        deviceId: "device_test",
      });
      client.send({ type: "list_projects", requestId: asRequestId("req_projects") });
      await expect(client.waitFor((message) => "requestId" in message && message.requestId === "req_projects")).resolves.toMatchObject({
        type: "response",
        requestType: "list_projects",
        data: { projects: [project] },
      });
    } finally {
      client.close();
      await server.close();
    }
  });

  it("rejects an invalid remote WebSocket token", async () => {
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: () => undefined,
    });
    const client = await connectTestWebSocket(server.url, "wrong-secret", "client_bad");
    try {
      await expect(client.waitFor((message) => message.type === "error")).resolves.toMatchObject({
        type: "error",
        code: "auth_failed",
      });
    } finally {
      client.close();
      await server.close();
    }
  });
});

const response = (messages: DaemonMessage[], requestId: string): DaemonMessage | undefined =>
  messages.find((message) => "requestId" in message && message.requestId === requestId);

const waitForMessage = async (
  messages: DaemonMessage[],
  predicate: (message: DaemonMessage) => boolean,
): Promise<DaemonMessage> => {
  const started = Date.now();
  while (Date.now() - started < 1_000) {
    const message = messages.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for daemon message");
};

const connectTestWebSocket = async (url: string, token: string, clientId: string) => {
  const socket = new WebSocket(url);
  const messages: DaemonMessage[] = [];
  await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
  socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as DaemonMessage));
  socket.send(JSON.stringify({ type: "connect", token, clientId }));
  return {
    send(message: object) {
      socket.send(JSON.stringify(message));
    },
    waitFor(predicate: (message: DaemonMessage) => boolean): Promise<DaemonMessage> {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const message = messages.find(predicate);
          if (message) {
            clearInterval(interval);
            resolve(message);
          }
        }, 1);
      });
    },
    close() {
      socket.close();
    },
  };
};
