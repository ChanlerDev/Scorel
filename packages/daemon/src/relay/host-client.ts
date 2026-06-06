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
  reconnectDelayMs?: number;
  onDiagnostic?: (type: string, data?: Record<string, unknown>) => void;
};

export type HostRelayClient = {
  close(): void;
};

export const startHostRelayClient = async (options: HostRelayClientOptions): Promise<HostRelayClient> => {
  const client = new ReconnectingHostRelayClient(options);
  await client.start();
  return client;
};

class ReconnectingHostRelayClient implements HostRelayClient {
  readonly #options: HostRelayClientOptions;
  #socket: WebSocket | undefined;
  #connections = new Map<ClientId, HostConnection>();
  #closed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: HostRelayClientOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    await this.#connect();
  }

  close(): void {
    this.#closed = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#disconnectHostConnections();
    this.#socket?.close();
  }

  async #connect(): Promise<void> {
    if (this.#closed) {
      return;
    }
    const socket = this.#options.createWebSocket?.(this.#options.relayUrl) ?? new WebSocket(this.#options.relayUrl);
    this.#socket = socket;
    await waitForOpen(socket);
    if (this.#closed) {
      socket.close();
      return;
    }
    sendHostFrame(socket, {
      type: "host_hello",
      deviceId: this.#options.deviceId,
      label: this.#options.deviceDisplayName,
    });
    this.#options.onDiagnostic?.("relay_host_connected", { relayUrl: this.#options.relayUrl, deviceId: this.#options.deviceId });

    socket.on("message", (data) => {
      void handleRelayFrame({
        frame: JSON.parse(data.toString()) as RelayServerFrame,
        socket,
        connections: this.#connections,
        options: this.#options,
      }).catch((cause) => {
        this.#options.onDiagnostic?.("relay_host_error", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    });
    socket.on("error", (cause) => {
      this.#options.onDiagnostic?.("relay_host_error", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });

    socket.once("close", () => {
      if (this.#socket === socket) {
        this.#socket = undefined;
      }
      this.#disconnectHostConnections();
      this.#options.onDiagnostic?.("relay_host_disconnected", { relayUrl: this.#options.relayUrl, deviceId: this.#options.deviceId });
      this.#scheduleReconnect();
    });
  }

  #disconnectHostConnections(): void {
    for (const connection of this.#connections.values()) {
      this.#options.hostService.disconnect(connection);
    }
    this.#connections.clear();
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer) {
      return;
    }
    const delayMs = this.#options.reconnectDelayMs ?? 1000;
    this.#options.onDiagnostic?.("relay_host_reconnecting", {
      relayUrl: this.#options.relayUrl,
      deviceId: this.#options.deviceId,
      delayMs,
    });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect().catch((cause) => {
        this.#options.onDiagnostic?.("relay_host_error", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        this.#scheduleReconnect();
      });
    }, delayMs);
  }
}

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
