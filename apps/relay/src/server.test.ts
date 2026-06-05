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
  type RelayResponse,
  type RelayServerFrame,
} from "@scorel/protocol";

import { MemoryRelayDiagnostics } from "./diagnostics.js";
import { RelayPairing } from "./pairing.js";
import { startRelayServer, type RelayServer } from "./server.js";
import { FileRelayStore } from "./store.js";

const servers: RelayServer[] = [];
const tempDirs: string[] = [];
const sockets: WebSocket[] = [];

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

describe("Relay server", () => {
  it("creates and redeems a pair session, persists binding, and lists authorized devices", async () => {
    const { url, store } = await startTestRelay();
    const entry = await connect(url);
    const host = await connect(url);

    send(entry, { type: "entry_hello", clientId: asClientId("client_web") });
    send(host, { type: "host_hello", deviceId: asDeviceId("device_laptop"), label: "Laptop" });
    send(entry, {
      type: "create_pair_session",
      requestId: asRequestId("relay_req_pair"),
    });
    const pair = await nextRelayResponse(entry);
    expect(pair).toMatchObject({ type: "relay_response", ok: true, requestId: "relay_req_pair" });
    if (!pair.ok || !("pairCode" in pair.data)) {
      throw new Error("expected pair response");
    }

    send(host, {
      type: "redeem_pair",
      requestId: asRequestId("relay_req_redeem"),
      pairCode: pair.data.pairCode,
      deviceId: asDeviceId("device_laptop"),
    });
    await expect(nextRelayResponse(host)).resolves.toMatchObject({
      type: "relay_response",
      ok: true,
      requestId: "relay_req_redeem",
      data: { clientId: "client_web" },
    });

    await expect(store.isBound({ deviceId: asDeviceId("device_laptop"), clientId: asClientId("client_web") })).resolves.toBe(true);

    send(entry, { type: "list_authorized_devices", requestId: asRequestId("relay_req_list") });
    await expect(nextRelayResponse(entry)).resolves.toMatchObject({
      type: "relay_response",
      ok: true,
      data: {
        devices: [
          {
            deviceId: "device_laptop",
            label: "Laptop",
            online: true,
          },
        ],
      },
    });
  });

  it("rejects expired and single-use pair codes", async () => {
    let now = 1_000;
    const { url } = await startTestRelay({
      pairing: new RelayPairing({ ttlMs: 10, now: () => now, createPairCode: () => "123456" }),
      now: () => now,
    });
    const entry = await connect(url);
    const host = await connect(url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_web") });
    send(host, { type: "host_hello", deviceId: asDeviceId("device_laptop") });
    send(entry, { type: "create_pair_session", requestId: asRequestId("relay_req_pair") });
    await nextRelayResponse(entry);

    now = 1_011;
    send(host, {
      type: "redeem_pair",
      requestId: asRequestId("relay_req_expired"),
      pairCode: "123456",
      deviceId: asDeviceId("device_laptop"),
    });
    await expect(nextRelayResponse(host)).resolves.toMatchObject({
      type: "relay_error",
      ok: false,
      code: "pair_expired",
    });

    now = 2_000;
    send(entry, { type: "create_pair_session", requestId: asRequestId("relay_req_pair2") });
    await nextRelayResponse(entry);
    send(host, {
      type: "redeem_pair",
      requestId: asRequestId("relay_req_ok"),
      pairCode: "123456",
      deviceId: asDeviceId("device_laptop"),
    });
    await expect(nextRelayResponse(host)).resolves.toMatchObject({ type: "relay_response", ok: true });
    send(host, {
      type: "redeem_pair",
      requestId: asRequestId("relay_req_again"),
      pairCode: "123456",
      deviceId: asDeviceId("device_laptop"),
    });
    await expect(nextRelayResponse(host)).resolves.toMatchObject({
      type: "relay_error",
      ok: false,
      code: "pair_not_found",
    });
  });

  it("routes authorized daemon wire payloads and rejects unbound or offline routes", async () => {
    const { url } = await startTestRelay();
    const entry = await connect(url);
    const host = await connect(url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_web") });
    send(host, { type: "host_hello", deviceId: asDeviceId("device_laptop") });

    send(entry, {
      type: "entry_to_device",
      deviceId: asDeviceId("device_laptop"),
      payload: { type: "get_status", requestId: asRequestId("req_status") },
    });
    await expect(nextRelayResponse(entry)).resolves.toMatchObject({
      type: "relay_error",
      ok: false,
      code: "unauthorized",
      requestId: "req_status",
    });

    await pair(entry, host);
    send(entry, {
      type: "entry_to_device",
      deviceId: asDeviceId("device_laptop"),
      payload: { type: "get_status", requestId: asRequestId("req_status") },
    });
    await expect(nextServerFrame(host)).resolves.toMatchObject({
      type: "relay_to_host",
      clientId: "client_web",
      payload: { type: "get_status", requestId: "req_status" },
    });

    send(host, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: {
        type: "response",
        requestType: "get_status",
        requestId: asRequestId("req_status"),
        ok: true,
        data: { running: false, activeClients: [], sessionCount: 0, uptimeMs: 0 },
      },
    });
    await expect(nextServerFrame(entry)).resolves.toMatchObject({
      type: "device_to_entry",
      deviceId: "device_laptop",
      payload: {
        type: "response",
        requestId: "req_status",
      },
    });

    await closeSocket(host);
    send(entry, {
      type: "entry_to_device",
      deviceId: asDeviceId("device_laptop"),
      payload: { type: "ping", requestId: asRequestId("req_ping") },
    });
    await expect(nextRelayResponse(entry)).resolves.toMatchObject({
      type: "relay_error",
      ok: false,
      code: "device_offline",
      requestId: "req_ping",
    });
  });

  it("fans host responses out to every online Entry socket for the same clientId", async () => {
    const { url } = await startTestRelay();
    const entryA = await connect(url);
    const entryB = await connect(url);
    const host = await connect(url);
    send(entryA, { type: "entry_hello", clientId: asClientId("client_web") });
    send(entryB, { type: "entry_hello", clientId: asClientId("client_web") });
    send(host, { type: "host_hello", deviceId: asDeviceId("device_laptop") });
    await pair(entryA, host);

    send(host, {
      type: "host_to_entry",
      clientId: asClientId("client_web"),
      payload: { type: "pong", requestId: asRequestId("req_ping") },
    });

    await expect(nextServerFrame(entryA)).resolves.toMatchObject({ type: "device_to_entry", payload: { type: "pong" } });
    await expect(nextServerFrame(entryB)).resolves.toMatchObject({ type: "device_to_entry", payload: { type: "pong" } });
  });

  it("does not put daemon payload bodies in diagnostics", async () => {
    const diagnostics = new MemoryRelayDiagnostics();
    const { url } = await startTestRelay({ diagnostics });
    const entry = await connect(url);
    const host = await connect(url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_web") });
    send(host, { type: "host_hello", deviceId: asDeviceId("device_laptop") });
    await pair(entry, host);

    send(entry, {
      type: "entry_to_device",
      deviceId: asDeviceId("device_laptop"),
      payload: {
        type: "send_message",
        requestId: asRequestId("req_secret"),
        sessionId: "ses_1" as never,
        content: "do not log this prompt",
      },
    });
    await nextServerFrame(host);

    expect(JSON.stringify(diagnostics.events)).not.toContain("do not log this prompt");
    expect(JSON.stringify(diagnostics.events)).toContain("send_message");
  });
});

const startTestRelay = async (
  options: { diagnostics?: MemoryRelayDiagnostics; pairing?: RelayPairing; now?: () => number } = {},
) => {
  const dataDir = await mkdtemp(join(tmpdir(), "scorel-relay-"));
  tempDirs.push(dataDir);
  const store = new FileRelayStore({ dataDir, now: options.now });
  const server = await startRelayServer({
    host: "127.0.0.1",
    port: 0,
    store,
    diagnostics: options.diagnostics ?? new MemoryRelayDiagnostics({ now: options.now }),
    pairing: options.pairing,
    now: options.now,
  });
  servers.push(server);
  return { ...server, store };
};

const connect = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });

const closeSocket = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.readyState === socket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
    socket.close();
  });

const send = (socket: WebSocket, value: unknown): void => {
  socket.send(JSON.stringify(value));
};

const nextServerFrame = (socket: WebSocket): Promise<RelayServerFrame> =>
  new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as RelayServerFrame));
  });

const nextRelayResponse = async (socket: WebSocket): Promise<RelayResponse> => {
  const frame = await nextServerFrame(socket);
  if (frame.type !== "relay_response" && frame.type !== "relay_error") {
    throw new Error(`expected relay response, got ${frame.type}`);
  }
  return frame;
};

const pair = async (entry: WebSocket, host: WebSocket): Promise<void> => {
  send(entry, { type: "create_pair_session", requestId: asRequestId("relay_req_pair") });
  const pairResponse = await nextRelayResponse(entry);
  if (!pairResponse.ok || !("pairCode" in pairResponse.data)) {
    throw new Error("expected pair response");
  }
  send(host, {
    type: "redeem_pair",
    requestId: asRequestId("relay_req_redeem"),
    pairCode: pairResponse.data.pairCode,
    deviceId: asDeviceId("device_laptop"),
  });
  await nextRelayResponse(host);
};
