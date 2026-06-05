import type { ClientId, ClientMessage, DaemonMessage, DeviceId, RelayToEntryFrame, RelayToHostFrame } from "@scorel/protocol";
import type { WebSocket } from "ws";

import type { RelayDiagnostics } from "./diagnostics.js";
import type { RelayPresence } from "./presence.js";
import type { RelayStore } from "./store.js";

export type RelayRouteResult =
  | { ok: true }
  | { ok: false; code: "unauthorized" | "device_offline" | "client_offline"; message: string };

export const routeEntryToDevice = async (
  input: {
    store: RelayStore;
    presence: RelayPresence;
    diagnostics: RelayDiagnostics;
    clientId: ClientId;
    deviceId: DeviceId;
    payload: ClientMessage;
  },
): Promise<RelayRouteResult> => {
  if (!(await input.store.isBound({ clientId: input.clientId, deviceId: input.deviceId }))) {
    input.diagnostics.record("entry_route_rejected", {
      clientId: input.clientId,
      deviceId: input.deviceId,
      reason: "unauthorized",
    });
    return { ok: false, code: "unauthorized", message: "entry is not authorized for device" };
  }
  const socket = input.presence.deviceSocket(input.deviceId);
  if (!socket) {
    input.diagnostics.record("entry_route_rejected", {
      clientId: input.clientId,
      deviceId: input.deviceId,
      reason: "device_offline",
    });
    return { ok: false, code: "device_offline", message: "device is offline" };
  }
  sendJson(socket, {
    type: "relay_to_host",
    clientId: input.clientId,
    payload: input.payload,
  } satisfies RelayToHostFrame);
  input.diagnostics.record("entry_route_forwarded", {
    clientId: input.clientId,
    deviceId: input.deviceId,
    payloadType: input.payload.type,
  });
  return { ok: true };
};

export const routeHostToEntry = (
  input: {
    presence: RelayPresence;
    diagnostics: RelayDiagnostics;
    deviceId: DeviceId;
    clientId: ClientId;
    payload: DaemonMessage;
  },
): RelayRouteResult => {
  const sockets = input.presence.clientSockets(input.clientId);
  if (sockets.length === 0) {
    input.diagnostics.record("host_route_rejected", {
      clientId: input.clientId,
      deviceId: input.deviceId,
      reason: "client_offline",
    });
    return { ok: false, code: "client_offline", message: "entry is offline" };
  }
  for (const socket of sockets) {
    sendJson(socket, {
      type: "device_to_entry",
      deviceId: input.deviceId,
      payload: input.payload,
    } satisfies RelayToEntryFrame);
  }
  input.diagnostics.record("host_route_forwarded", {
    clientId: input.clientId,
    deviceId: input.deviceId,
    payloadType: input.payload.type,
    clientSocketCount: sockets.length,
  });
  return { ok: true };
};

const sendJson = (socket: WebSocket, value: unknown): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(value));
  }
};
