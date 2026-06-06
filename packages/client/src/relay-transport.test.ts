import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSeq,
  asSessionId,
  type DaemonMessage,
  type RelayServerFrame,
} from "@scorel/protocol";
import { FileRelayStore, MemoryRelayDiagnostics, startRelayServer, type RelayServer } from "../../../apps/relay/src/library.js";

import { RelayTransport } from "./index.js";

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("RelayTransport", () => {
  it("connects through Relay and resolves the Host connected payload", async () => {
    const fixture = await relayFixture({ bind: true, hostOnline: true });
    const transport = createTransport(fixture.relay.url);

    const connecting = transport.connect({
      clientId: asClientId("client_web"),
      sessionId: asSessionId("ses_1"),
      persistentLastSeq: asSeq(0),
      streamLastSeq: asSeq(0),
    });

    const connectFrame = await nextServerFrame(fixture.host!);
    expect(connectFrame).toMatchObject({
      type: "relay_to_host",
      clientId: "client_web",
      payload: {
        type: "connect",
        sessionId: "ses_1",
      },
    });
    send(fixture.host!, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: {
        type: "connected",
        clientId: asClientId("client_web"),
        sessionId: asSessionId("ses_1"),
        currentSeq: asSeq(0),
        deviceId: asDeviceId("device_relay"),
        deviceDisplayName: "Relay host",
      },
    });

    await expect(connecting).resolves.toEqual({
      clientId: "client_web",
      sessionId: "ses_1",
      currentSeq: 0,
      deviceId: "device_relay",
      deviceDisplayName: "Relay host",
    });
  });

  it("routes requests, responses, and events through Relay", async () => {
    const fixture = await relayFixture({ bind: true, hostOnline: true });
    const transport = createTransport(fixture.relay.url);
    const seen: DaemonMessage[] = [];
    transport.onMessage((message) => seen.push(message));

    const connecting = transport.connect({ clientId: asClientId("client_web") });
    await nextServerFrame(fixture.host!);
    send(fixture.host!, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: {
        type: "connected",
        clientId: asClientId("client_web"),
        currentSeq: asSeq(0),
        deviceId: asDeviceId("device_relay"),
      },
    });
    await connecting;

    transport.send({ type: "ping", requestId: asRequestId("req_ping") });
    await expect(nextServerFrame(fixture.host!)).resolves.toMatchObject({
      type: "relay_to_host",
      payload: { type: "ping", requestId: "req_ping" },
    });
    send(fixture.host!, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: { type: "pong", requestId: asRequestId("req_ping") },
    });
    send(fixture.host!, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: {
        type: "event",
        event: {
          type: "text_delta",
          seq: asSeq(1),
          sessionId: asSessionId("ses_1"),
          clientId: asClientId("client_web"),
          ts: 1,
          eventId: "evt_1" as never,
          delta: "hi",
        },
      },
    });

    await waitFor(() => seen.some((message) => message.type === "pong"), "pong");
    await waitFor(() => seen.some((message) => message.type === "event"), "event");
  });

  it("rejects unauthorized and offline connect attempts", async () => {
    const unauthorized = await relayFixture({ bind: false, hostOnline: true });
    await expect(createTransport(unauthorized.relay.url).connect({ clientId: asClientId("client_web") }))
      .rejects.toThrow(/authorized/);

    const offline = await relayFixture({ bind: true, hostOnline: false });
    await expect(createTransport(offline.relay.url).connect({ clientId: asClientId("client_web") }))
      .rejects.toThrow(/offline/);
  });

  it("cleans up on close", async () => {
    const fixture = await relayFixture({ bind: true, hostOnline: true });
    const transport = createTransport(fixture.relay.url);
    const connecting = transport.connect({ clientId: asClientId("client_web") });
    await nextServerFrame(fixture.host!);
    send(fixture.host!, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: {
        type: "connected",
        clientId: asClientId("client_web"),
        currentSeq: asSeq(0),
        deviceId: asDeviceId("device_relay"),
      },
    });
    await connecting;

    transport.close();

    expect(() => transport.send({ type: "ping", requestId: asRequestId("req_after_close") })).toThrow(/not connected/);
  });
});

const relayFixture = async (options: { bind: boolean; hostOnline: boolean }) => {
  const root = await mkdtemp(join(tmpdir(), "scorel-client-relay-"));
  tempDirs.push(root);
  const store = new FileRelayStore({ dataDir: join(root, "relay") });
  const relay = await startRelayServer({
    host: "127.0.0.1",
    port: 0,
    store,
    diagnostics: new MemoryRelayDiagnostics(),
  });
  servers.push(relay);
  let host: WebSocket | undefined;
  if (options.hostOnline) {
    host = await connect(relay.url);
    send(host, { type: "host_hello", deviceId: asDeviceId("device_relay"), label: "Relay host" });
  }
  if (options.bind) {
    await store.bind({ deviceId: asDeviceId("device_relay"), clientId: asClientId("client_web") });
  }
  if (host && options.bind) {
    await waitForDeviceRecord(store);
  }
  return { relay, store, host };
};

const createTransport = (relayUrl: string): RelayTransport =>
  new RelayTransport({
    relayUrl,
    deviceId: asDeviceId("device_relay"),
    clientId: asClientId("client_web"),
    createWebSocket: (url) => new WebSocket(url) as never,
  });

const connect = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });

const send = (socket: WebSocket, value: unknown): void => {
  socket.send(JSON.stringify(value));
};

const nextServerFrame = (socket: WebSocket): Promise<RelayServerFrame> =>
  new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as RelayServerFrame));
  });

const waitForDeviceRecord = async (store: FileRelayStore): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const devices = await store.listDevicesForClient(asClientId("client_web"));
    if (devices.some((device) => device.deviceId === "device_relay")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for relay device record");
};

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};
