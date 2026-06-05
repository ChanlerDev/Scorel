import { WebSocketServer, type WebSocket } from "ws";

import {
  type ClientId,
  type DeviceId,
  type RelayEntryFrame,
  type RelayHostFrame,
  type RelayResponse,
  type RequestId,
} from "@scorel/protocol";

import { createConsoleRelayDiagnostics, type RelayDiagnostics } from "./diagnostics.js";
import { RelayPairing } from "./pairing.js";
import { RelayPresence } from "./presence.js";
import { routeEntryToDevice, routeHostToEntry } from "./routing.js";
import type { RelayStore } from "./store.js";

export type RelayServerOptions = {
  host: string;
  port: number;
  store: RelayStore;
  diagnostics?: RelayDiagnostics;
  pairing?: RelayPairing;
  now?: () => number;
};

export type RelayServer = {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
};

type SocketState = {
  clientId?: ClientId;
  deviceId?: DeviceId;
};

export const startRelayServer = async (options: RelayServerOptions): Promise<RelayServer> => {
  const diagnostics = options.diagnostics ?? createConsoleRelayDiagnostics();
  const pairing = options.pairing ?? new RelayPairing();
  const presence = new RelayPresence();
  const socketStates = new WeakMap<WebSocket, SocketState>();
  const now = options.now ?? Date.now;
  const server = new WebSocketServer({ host: options.host, port: options.port });

  server.on("connection", (socket) => {
    socketStates.set(socket, {});
    diagnostics.record("socket_connected");
    let queue = Promise.resolve();

    socket.on("message", (data) => {
      queue = queue.then(async () => {
        const state = socketStates.get(socket) ?? {};
        const frame = parseFrame(data);
        if (!frame) {
          sendError(socket, undefined, "invalid_request", "invalid relay frame");
          return;
        }
        if (isEntryFrame(frame)) {
          await handleEntryFrame({ frame, socket, state, store: options.store, diagnostics, pairing, presence, now });
          return;
        }
        await handleHostFrame({ frame, socket, state, store: options.store, diagnostics, pairing, presence, now });
      }).catch((cause) => {
        diagnostics.record("relay_internal_error", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        sendError(socket, undefined, "internal_error", cause instanceof Error ? cause.message : String(cause));
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeWebSocketServer(server);
    throw new Error("relay server did not expose a TCP address");
  }
  const host = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  return {
    host: options.host,
    port: address.port,
    url: `ws://${host}:${address.port}`,
    close: () => closeWebSocketServer(server),
  };
};

const handleEntryFrame = async (
  input: {
    frame: RelayEntryFrame;
    socket: WebSocket;
    state: SocketState;
    store: RelayStore;
    diagnostics: RelayDiagnostics;
    pairing: RelayPairing;
    presence: RelayPresence;
    now: () => number;
  },
): Promise<void> => {
  switch (input.frame.type) {
    case "entry_hello": {
      input.state.clientId = input.frame.clientId;
      input.presence.addClient(input.frame.clientId, input.socket);
      const ts = input.now();
      await input.store.upsertClient({
        clientId: input.frame.clientId,
        label: input.frame.label,
        publicKey: input.frame.publicKey,
        createdAt: ts,
        updatedAt: ts,
      });
      input.diagnostics.record("entry_online", { clientId: input.frame.clientId });
      return;
    }
    case "create_pair_session": {
      const clientId = input.frame.clientId ?? input.state.clientId;
      if (!clientId) {
        sendError(input.socket, input.frame.requestId, "not_announced", "entry must announce clientId before pairing");
        return;
      }
      const session = input.pairing.create(clientId);
      input.diagnostics.record("pair_session_created", { clientId, pairCode: session.pairCode });
      sendResponse(input.socket, input.frame.requestId, {
        pairCode: session.pairCode,
        expiresAt: session.expiresAt,
      });
      return;
    }
    case "list_authorized_devices": {
      if (!input.state.clientId) {
        sendError(input.socket, input.frame.requestId, "not_announced", "entry must announce clientId before listing devices");
        return;
      }
      const devices = await input.store.listDevicesForClient(input.state.clientId);
      sendResponse(input.socket, input.frame.requestId, {
        devices: devices.map((device) => ({
          ...device,
          online: input.presence.isDeviceOnline(device.deviceId),
        })),
      });
      return;
    }
    case "entry_to_device": {
      if (!input.state.clientId) {
        sendError(input.socket, undefined, "not_announced", "entry must announce clientId before routing");
        return;
      }
      const result = await routeEntryToDevice({
        store: input.store,
        presence: input.presence,
        diagnostics: input.diagnostics,
        clientId: input.state.clientId,
        deviceId: input.frame.deviceId,
        payload: input.frame.payload,
      });
      if (!result.ok) {
        sendError(input.socket, "requestId" in input.frame.payload ? input.frame.payload.requestId : undefined, result.code, result.message);
      }
      return;
    }
  }
};

const handleHostFrame = async (
  input: {
    frame: RelayHostFrame;
    socket: WebSocket;
    state: SocketState;
    store: RelayStore;
    diagnostics: RelayDiagnostics;
    pairing: RelayPairing;
    presence: RelayPresence;
    now: () => number;
  },
): Promise<void> => {
  switch (input.frame.type) {
    case "host_hello": {
      input.state.deviceId = input.frame.deviceId;
      input.presence.setDevice(input.frame.deviceId, input.socket);
      const ts = input.now();
      await input.store.upsertDevice({
        deviceId: input.frame.deviceId,
        label: input.frame.label,
        publicKey: input.frame.publicKey,
        createdAt: ts,
        updatedAt: ts,
      });
      input.diagnostics.record("device_online", { deviceId: input.frame.deviceId });
      return;
    }
    case "redeem_pair": {
      const result = input.pairing.consume(input.frame.pairCode);
      if (!result.ok) {
        sendError(
          input.socket,
          input.frame.requestId,
          result.reason === "expired" ? "pair_expired" : "pair_not_found",
          result.reason === "expired" ? "pair code expired" : "pair code not found",
        );
        return;
      }
      await input.store.bind({ deviceId: input.frame.deviceId, clientId: result.clientId });
      input.diagnostics.record("pair_session_redeemed", {
        deviceId: input.frame.deviceId,
        clientId: result.clientId,
      });
      sendResponse(input.socket, input.frame.requestId, { clientId: result.clientId });
      return;
    }
    case "host_to_entry": {
      if (!input.state.deviceId) {
        sendError(input.socket, undefined, "not_announced", "host must announce deviceId before routing");
        return;
      }
      const result = routeHostToEntry({
        presence: input.presence,
        diagnostics: input.diagnostics,
        deviceId: input.state.deviceId,
        clientId: input.frame.clientId,
        payload: input.frame.payload,
      });
      if (!result.ok) {
        sendError(input.socket, undefined, result.code, result.message);
      }
      return;
    }
  }
};

const isEntryFrame = (frame: RelayEntryFrame | RelayHostFrame): frame is RelayEntryFrame =>
  frame.type === "entry_hello" ||
  frame.type === "create_pair_session" ||
  frame.type === "entry_to_device" ||
  frame.type === "list_authorized_devices";

const parseFrame = (data: unknown): RelayEntryFrame | RelayHostFrame | null => {
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const frame = JSON.parse(text) as { type?: unknown };
    return typeof frame.type === "string" ? (frame as RelayEntryFrame | RelayHostFrame) : null;
  } catch {
    return null;
  }
};

const sendResponse = (
  socket: WebSocket,
  requestId: RequestId,
  data: Extract<RelayResponse, { ok: true }>["data"],
): void => {
  sendJson(socket, { type: "relay_response", requestId, ok: true, data } satisfies RelayResponse);
};

const sendError = (
  socket: WebSocket,
  requestId: RequestId | undefined,
  code: Extract<RelayResponse, { ok: false }>["code"],
  message: string,
): void => {
  sendJson(socket, { type: "relay_error", requestId, ok: false, code, message } satisfies RelayResponse);
};

const sendJson = (socket: WebSocket, value: unknown): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(value));
  }
};

const closeWebSocketServer = (server: WebSocketServer): Promise<void> =>
  new Promise((resolve, reject) => {
    for (const client of server.clients) {
      client.close();
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
