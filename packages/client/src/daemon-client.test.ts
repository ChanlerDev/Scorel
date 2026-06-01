import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import {
  asClientId,
  asDeviceId,
  asEventId,
  asProjectId,
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
    return { clientId: asClientId("client_test"), currentSeq: asSeq(0), deviceId: asDeviceId("device_test") };
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
    expect(client.streamLastSeq).toBe(2);
    expect(client.persistentLastSeq).toBe(2);
    expect(client.getEvents().map((event) => event.id)).toEqual(["evt_assistant"]);
    expect(client.getActiveLeaf()).toBe("evt_assistant");
  });

  it("stores daemon connection identity returned by the transport", async () => {
    class IdentityTransport extends MemoryTransport {
      override async connect(_params: ConnectParams): Promise<ConnectResult> {
        return {
          clientId: asClientId("client_test"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_tokyo"),
          deviceDisplayName: "Tokyo VPS",
        };
      }
    }
    const client = new DaemonClient(new IdentityTransport(), {
      clientId: asClientId("client_test"),
    });

    await client.connect(asSessionId("ses_1"));

    expect(client.connectionIdentity).toEqual({
      deviceId: "device_tokyo",
      deviceDisplayName: "Tokyo VPS",
    });
  });

  it("separates durable persistent and observed stream anchors during resync", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_resync"),
    });

    await client.connect(asSessionId("ses_1"));
    transport.emit({
      type: "event",
      event: {
        type: "assistant_message",
        id: asEventId("evt_persistent"),
        parentId: null,
        seq: asSeq(2),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("client_test"),
        ts: 2,
        message: { role: "assistant", content: [{ type: "text", text: "persisted" }] },
      },
    });
    transport.emit({
      type: "event",
      event: {
        type: "text_delta",
        seq: asSeq(5),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("client_test"),
        ts: 5,
        eventId: asEventId("evt_streaming"),
        delta: "partial",
      },
    });

    const pending = client.resync();
    expect(transport.sent.at(-1)).toMatchObject({
      type: "resync_events",
      persistentLastSeq: asSeq(2),
      streamLastSeq: asSeq(5),
    });
    transport.emit({
      type: "response",
      requestType: "resync_events",
      requestId: asRequestId("req_resync"),
      ok: true,
      data: {
        events: [],
        throughSeq: asSeq(2),
        mode: "persistent_fallback",
        gapFromSeq: asSeq(3),
        gapToSeq: asSeq(5),
      },
    });

    await expect(pending).resolves.toMatchObject({ mode: "persistent_fallback" });
    expect(client.persistentLastSeq).toBe(2);
    expect(client.streamLastSeq).toBe(5);
  });

  it("rebuilds local persistent projection on full reload", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_reload"),
    });

    await client.connect(asSessionId("ses_1"));
    transport.emit({
      type: "event",
      event: {
        type: "assistant_message",
        id: asEventId("evt_stale"),
        parentId: null,
        seq: asSeq(2),
        sessionId: asSessionId("ses_1"),
        clientId: asClientId("client_test"),
        ts: 2,
        message: { role: "assistant", content: [{ type: "text", text: "stale" }] },
      },
    });

    const pending = client.resync({ persistentLastSeq: asSeq(0), streamLastSeq: asSeq(0) });
    transport.emit({
      type: "response",
      requestType: "resync_events",
      requestId: asRequestId("req_reload"),
      ok: true,
      data: {
        mode: "full_reload",
        throughSeq: asSeq(1),
        events: [
          {
            type: "user_message",
            id: asEventId("evt_fresh"),
            parentId: null,
            seq: asSeq(1),
            sessionId: asSessionId("ses_1"),
            clientId: asClientId("client_test"),
            ts: 1,
            message: { role: "user", content: [{ type: "text", text: "fresh" }] },
          },
        ],
      },
    });

    await expect(pending).resolves.toMatchObject({ mode: "full_reload" });
    expect(client.getEvents().map((event) => event.id)).toEqual(["evt_fresh"]);
  });

  it("emits resynced transient events to subscribers", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_resync_emit"),
    });
    const seen: string[] = [];

    await client.connect(asSessionId("ses_1"));
    client.subscribe((event) => {
      if (event.type === "text_delta") {
        seen.push(event.delta);
      }
    });
    const pending = client.resync({ persistentLastSeq: asSeq(1), streamLastSeq: asSeq(2) });
    transport.emit({
      type: "response",
      requestType: "resync_events",
      requestId: asRequestId("req_resync_emit"),
      ok: true,
      data: {
        mode: "stream_resume",
        throughSeq: asSeq(3),
        events: [
          {
            type: "text_delta",
            seq: asSeq(3),
            sessionId: asSessionId("ses_1"),
            clientId: asClientId("client_test"),
            ts: 3,
            eventId: asEventId("evt_streaming"),
            delta: "missed",
          },
        ],
      },
    });

    await expect(pending).resolves.toMatchObject({ mode: "stream_resume" });
    expect(seen).toEqual(["missed"]);
  });

  it("sends cancel for the active session and resolves with daemon response", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_cancel"),
    });

    await client.connect(asSessionId("ses_cancel"));
    const pending = client.cancel();

    expect(transport.sent.at(-1)).toMatchObject({
      type: "cancel",
      requestId: "req_cancel",
      sessionId: "ses_cancel",
    });

    transport.emit({
      type: "response",
      requestType: "cancel",
      requestId: asRequestId("req_cancel"),
      ok: true,
      data: { sessionId: asSessionId("ses_cancel"), cancelled: true },
    });

    await expect(pending).resolves.toEqual({ sessionId: "ses_cancel", cancelled: true });
  });

  it("connects without a session id and captures identity from the daemon handshake", async () => {
    class IdentityTransport extends MemoryTransport {
      lastParams: ConnectParams | undefined;
      override async connect(params: ConnectParams): Promise<ConnectResult> {
        this.lastParams = params;
        return {
          clientId: asClientId("client_test"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_tokyo"),
          deviceDisplayName: "Tokyo VPS",
        };
      }
    }
    const transport = new IdentityTransport();
    const client = new DaemonClient(transport, { clientId: asClientId("client_test") });

    await client.connect();

    expect(transport.lastParams?.sessionId).toBeUndefined();
    expect(client.state).toBe("connected");
    expect(client.sessionId).toBeNull();
    expect(client.connectionIdentity).toEqual({
      deviceId: "device_tokyo",
      deviceDisplayName: "Tokyo VPS",
    });
  });

  it("rejects cancel when no session is bound to the client", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, { clientId: asClientId("client_test") });

    await expect(client.cancel()).rejects.toThrow(/not connected to a session/);
  });

  it("forwards listSessions filter and surfaces SessionSummary entries", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_list_sessions"),
    });

    await client.connect(asSessionId("ses_listing"));
    const pending = client.listSessions({ projectId: asProjectId("prj_repo"), limit: 25 });

    expect(transport.sent.at(-1)).toMatchObject({
      type: "list_sessions",
      requestId: "req_list_sessions",
      projectId: "prj_repo",
      limit: 25,
    });

    transport.emit({
      type: "response",
      requestType: "list_sessions",
      requestId: asRequestId("req_list_sessions"),
      ok: true,
      data: {
        sessions: [
          {
            sessionId: asSessionId("ses_alpha"),
            updatedAt: 5,
            currentSeq: asSeq(3),
            projectId: asProjectId("prj_repo"),
          },
        ],
      },
    });

    await expect(pending).resolves.toEqual([
      {
        sessionId: "ses_alpha",
        updatedAt: 5,
        currentSeq: 3,
        projectId: "prj_repo",
      },
    ]);
  });

  it("returns HostProject list from listProjects", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId("req_list_projects"),
    });

    await client.connect(asSessionId("ses_listing"));
    const pending = client.listProjects();
    expect(transport.sent.at(-1)).toMatchObject({
      type: "list_projects",
      requestId: "req_list_projects",
    });

    transport.emit({
      type: "response",
      requestType: "list_projects",
      requestId: asRequestId("req_list_projects"),
      ok: true,
      data: {
        projects: [
          {
            projectId: asProjectId("prj_repo"),
            displayName: "repo",
            workDir: "/Users/test/repo",
            createdAt: 4,
            updatedAt: 17,
          },
        ],
      },
    });

    await expect(pending).resolves.toEqual([
      {
        projectId: "prj_repo",
        displayName: "repo",
        workDir: "/Users/test/repo",
        createdAt: 4,
        updatedAt: 17,
      },
    ]);
  });

  it("manages projects before binding a session", async () => {
    const transport = new MemoryTransport();
    let next = 0;
    const client = new DaemonClient(transport, {
      clientId: asClientId("client_test"),
      createRequestId: () => asRequestId(`req_project_${++next}`),
    });
    await client.connect();

    const directories = client.listDirectories("/Users/test");
    expect(transport.sent.at(-1)).toMatchObject({
      type: "list_directories",
      path: "/Users/test",
    });
    transport.emit({
      type: "response",
      requestType: "list_directories",
      requestId: asRequestId("req_project_1"),
      ok: true,
      data: {
        path: "/Users/test",
        entries: [{ name: "repo", path: "/Users/test/repo", kind: "directory" }],
      },
    });
    await expect(directories).resolves.toMatchObject({ path: "/Users/test" });

    const project = {
      projectId: asProjectId("prj_repo"),
      displayName: "repo",
      workDir: "/Users/test/repo",
      createdAt: 1,
      updatedAt: 1,
    };
    const registered = client.registerProject("/Users/test/repo");
    expect(transport.sent.at(-1)).toMatchObject({
      type: "register_project",
      workDir: "/Users/test/repo",
    });
    transport.emit({
      type: "response",
      requestType: "register_project",
      requestId: asRequestId("req_project_2"),
      ok: true,
      data: { project },
    });
    await expect(registered).resolves.toEqual(project);

    const removed = client.removeProject(project.projectId);
    expect(transport.sent.at(-1)).toMatchObject({
      type: "remove_project",
      projectId: "prj_repo",
    });
    transport.emit({
      type: "response",
      requestType: "remove_project",
      requestId: asRequestId("req_project_3"),
      ok: true,
      data: { projectId: project.projectId, removed: true },
    });
    await expect(removed).resolves.toBe(true);
  });

  it("rejects daemon-only operations when not connected", async () => {
    const transport = new MemoryTransport();
    const client = new DaemonClient(transport, { clientId: asClientId("client_test") });

    await expect(client.listSessions()).rejects.toThrow(/not connected to a daemon/);
    await expect(client.listProjects()).rejects.toThrow(/not connected to a daemon/);
    await expect(client.listDirectories()).rejects.toThrow(/not connected to a daemon/);
    await expect(client.registerProject("/repo")).rejects.toThrow(/not connected to a daemon/);
    await expect(client.removeProject(asProjectId("prj_repo"))).rejects.toThrow(/not connected to a daemon/);
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
          socket.send(JSON.stringify({
            type: "connected",
            clientId: message.clientId,
            sessionId: "ses_ws",
            currentSeq: 0,
            deviceId: "device_tokyo",
            deviceDisplayName: "Tokyo VPS",
          }));
        }
        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", requestId: message.requestId }));
        }
      });
    });
    const transport = new WsTransport({ url: `ws://127.0.0.1:${address.port}`, token: "remote-secret" });

    try {
      transport.onMessage((message) => messages.push(message));
      const connected = await transport.connect({ clientId: asClientId("client_ws"), sessionId: asSessionId("ses_ws") });
      const pong = waitForMessage(messages, (message) => message.type === "pong");
      transport.send({ type: "ping", requestId: asRequestId("req_ping") });

      expect(connected).toMatchObject({
        deviceId: "device_tokyo",
        deviceDisplayName: "Tokyo VPS",
      });
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
