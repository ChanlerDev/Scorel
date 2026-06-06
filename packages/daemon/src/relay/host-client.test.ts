import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  ScorelHost,
  authorizeRelayClient,
  startHostRelayClient,
  type HostRelayClient,
} from "../index.js";
import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSeq,
  type RelayServerFrame,
} from "@scorel/protocol";
import { FileRelayStore, MemoryRelayDiagnostics, startRelayServer, type RelayServer } from "../../../../apps/relay/src/library.js";

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];
const tempDirs: string[] = [];
const relayClients: HostRelayClient[] = [];
const hosts: ScorelHost[] = [];

afterEach(async () => {
  for (const relayClient of relayClients.splice(0)) {
    relayClient.close();
  }
  for (const host of hosts.splice(0)) {
    await host.shutdown();
  }
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

describe("Host relay client", () => {
  it("routes connect and get_status through the existing Host handler", async () => {
    const fixture = await relayHostFixture({ authorizedClient: asClientId("client_web") });
    const entry = await connect(fixture.relay.url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_web") });
    await waitForAuthorizedDeviceOnline(entry, fixture.deviceId);

    send(entry, {
      type: "entry_to_device",
      deviceId: fixture.deviceId,
      payload: {
        type: "connect",
        clientId: asClientId("client_web"),
        persistentLastSeq: asSeq(0),
        streamLastSeq: asSeq(0),
      },
    });
    await expect(nextServerFrame(entry)).resolves.toMatchObject({
      type: "device_to_entry",
      payload: {
        type: "connected",
        clientId: "client_web",
        deviceId: fixture.deviceId,
      },
    });

    send(entry, {
      type: "entry_to_device",
      deviceId: fixture.deviceId,
      payload: { type: "get_status", requestId: asRequestId("req_status") },
    });
    await expect(nextServerFrame(entry)).resolves.toMatchObject({
      type: "device_to_entry",
      payload: {
        type: "response",
        requestType: "get_status",
        requestId: "req_status",
        data: {
          activeClients: ["client_web"],
        },
      },
    });
  });

  it("rejects a relay-bound client that is not in the Host allowlist", async () => {
    const fixture = await relayHostFixture({ authorizedClient: asClientId("client_allowed") });
    await fixture.store.bind({ deviceId: fixture.deviceId, clientId: asClientId("client_bound_only") });
    const entry = await connect(fixture.relay.url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_bound_only") });
    await waitForAuthorizedDeviceOnline(entry, fixture.deviceId);

    send(entry, {
      type: "entry_to_device",
      deviceId: fixture.deviceId,
      payload: { type: "get_status", requestId: asRequestId("req_forbidden") },
    });

    await expect(nextServerFrame(entry)).resolves.toMatchObject({
      type: "device_to_entry",
      payload: {
        type: "error",
        requestId: "req_forbidden",
        code: "auth_failed",
      },
    });
  });

  it("reconnects after the Relay socket is lost", async () => {
    const diagnostics: string[] = [];
    const fixture = await relayHostFixture({
      authorizedClient: asClientId("client_reconnect"),
      reconnectDelayMs: 10,
      onDiagnostic: (type) => diagnostics.push(type),
    });
    const relayPort = fixture.relay.port;
    const relayIndex = servers.indexOf(fixture.relay);
    if (relayIndex >= 0) {
      servers.splice(relayIndex, 1);
    }
    await fixture.relay.close();
    const restarted = await startRelayServer({
      host: "127.0.0.1",
      port: relayPort,
      store: fixture.store,
      diagnostics: new MemoryRelayDiagnostics(),
    });
    servers.push(restarted);
    await waitFor(() => diagnostics.filter((type) => type === "relay_host_connected").length >= 2, "relay reconnect");

    const entry = await connect(restarted.url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_reconnect") });
    await waitForAuthorizedDeviceOnline(entry, fixture.deviceId);
  });
});

const relayHostFixture = async (options: {
  authorizedClient: ReturnType<typeof asClientId>;
  reconnectDelayMs?: number;
  onDiagnostic?: (type: string) => void;
}) => {
  const root = await mkdtemp(join(tmpdir(), "scorel-host-relay-"));
  tempDirs.push(root);
  const store = new FileRelayStore({ dataDir: join(root, "relay") });
  const relay = await startRelayServer({
    host: "127.0.0.1",
    port: 0,
    store,
    diagnostics: new MemoryRelayDiagnostics(),
  });
  servers.push(relay);
  const deviceId = asDeviceId("device_host_relay");
  const host = new ScorelHost({
    sessionsDir: join(root, "sessions"),
    projectsPath: join(root, "projects.json"),
    deviceId,
    createRuntime: async () => {
      throw new Error("get_status should not create a runtime");
    },
  });
  await host.start();
  hosts.push(host);
  await authorizeRelayClient({ stateDir: root, clientId: options.authorizedClient });
  await store.bind({ deviceId, clientId: options.authorizedClient });
  const relayClient = await startHostRelayClient({
    relayUrl: relay.url,
    hostService: host,
    deviceId,
    stateDir: root,
    reconnectDelayMs: options.reconnectDelayMs,
    onDiagnostic: options.onDiagnostic,
  });
  relayClients.push(relayClient);
  return { root, relay, store, host, relayClient, deviceId };
};

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

const waitForAuthorizedDeviceOnline = async (socket: WebSocket, deviceId: ReturnType<typeof asDeviceId>): Promise<void> => {
  const startedAt = Date.now();
  let counter = 0;
  while (Date.now() - startedAt < 1_000) {
    counter += 1;
    send(socket, { type: "list_authorized_devices", requestId: asRequestId(`relay_list_${counter}`) });
    const frame = await nextServerFrame(socket);
    if (
      frame.type === "relay_response" &&
      frame.ok &&
      "devices" in frame.data &&
      frame.data.devices.some((device) => device.deviceId === deviceId && device.online)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${deviceId} online`);
};

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};
