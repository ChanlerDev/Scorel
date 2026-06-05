import WebSocket from "ws";

import {
  asSeq,
  type ClientId,
  type DaemonMessage,
  type DeviceId,
  type RelayClientPayload,
  type RelayHostFrame,
  type RelayServerFrame,
} from "@scorel/protocol";

import type { ScorelHost } from "../index.js";
import { isRelayClientAuthorized } from "./auth.js";

type HostConnection = Parameters<ScorelHost["connect"]>[0];

export type HostRelayClientOptions = {
  relayUrl: string;
  hostService: ScorelHost;
  deviceId: DeviceId;
  deviceDisplayName?: string;
  stateDir: string;
  createWebSocket?: (url: string) => WebSocket;
  isAuthorized?: (clientId: ClientId) => Promise<boolean>;
  onDiagnostic?: (type: string, data?: Record<string, unknown>) => void;
};

export type HostRelayClient = {
  close(): void;
};

export const startHostRelayClient = async (options: HostRelayClientOptions): Promise<HostRelayClient> => {
  const socket = options.createWebSocket?.(options.relayUrl) ?? new WebSocket(options.relayUrl);
  const connections = new Map<ClientId, HostConnection>();
  await waitForOpen(socket);
  sendHostFrame(socket, {
    type: "host_hello",
    deviceId: options.deviceId,
    label: options.deviceDisplayName,
  });
  options.onDiagnostic?.("relay_host_connected", { relayUrl: options.relayUrl, deviceId: options.deviceId });

  socket.on("message", (data) => {
    void handleRelayFrame({
      frame: JSON.parse(data.toString()) as RelayServerFrame,
      socket,
      connections,
      options,
    }).catch((cause) => {
      options.onDiagnostic?.("relay_host_error", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  });

  socket.once("close", () => {
    for (const connection of connections.values()) {
      options.hostService.disconnect(connection);
    }
    connections.clear();
    options.onDiagnostic?.("relay_host_disconnected", { relayUrl: options.relayUrl, deviceId: options.deviceId });
  });

  return {
    close() {
      socket.close();
    },
  };
};

const handleRelayFrame = async (
  input: {
    frame: RelayServerFrame;
    socket: WebSocket;
    connections: Map<ClientId, HostConnection>;
    options: HostRelayClientOptions;
  },
): Promise<void> => {
  if (input.frame.type !== "relay_to_host") {
    return;
  }
  const authorized = input.options.isAuthorized
    ? await input.options.isAuthorized(input.frame.clientId)
    : await isRelayClientAuthorized({ stateDir: input.options.stateDir, clientId: input.frame.clientId });
  if (!authorized) {
    sendHostFrame(input.socket, {
      type: "host_to_entry",
      clientId: input.frame.clientId,
      payload: relayAuthError(input.frame.payload),
    });
    input.options.onDiagnostic?.("relay_frame_rejected", {
      clientId: input.frame.clientId,
      reason: "unauthorized",
      payloadType: input.frame.payload.type,
    });
    return;
  }

  const connection = connectionFor(input.connections, input.frame.clientId, input.socket);
  if (input.frame.payload.type === "connect") {
    const result = input.options.hostService.connect(connection, input.frame.payload.sessionId);
    sendHostFrame(input.socket, {
      type: "host_to_entry",
      clientId: input.frame.clientId,
      payload: {
        type: "connected",
        clientId: input.frame.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq ?? asSeq(0),
        deviceId: result.deviceId,
        deviceDisplayName: result.deviceDisplayName,
      },
    });
    return;
  }

  await input.options.hostService.handleMessage(connection, input.frame.payload);
};

const connectionFor = (
  connections: Map<ClientId, HostConnection>,
  clientId: ClientId,
  socket: WebSocket,
): HostConnection => {
  const existing = connections.get(clientId);
  if (existing) {
    return existing;
  }
  const connection: HostConnection = {
    clientId,
    emit(message: DaemonMessage) {
      sendHostFrame(socket, {
        type: "host_to_entry",
        clientId,
        payload: message,
      });
    },
  };
  connections.set(clientId, connection);
  return connection;
};

const relayAuthError = (payload: RelayClientPayload): DaemonMessage => ({
  type: "error",
  requestId: "requestId" in payload ? payload.requestId : undefined,
  ok: false,
  code: "auth_failed",
  message: "relay client is not authorized by host",
});

const sendHostFrame = (socket: WebSocket, frame: RelayHostFrame): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
};

const waitForOpen = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
