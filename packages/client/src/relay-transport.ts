import {
  type ClientId,
  type ClientMessage,
  type ConnectParams,
  type ConnectResult,
  type DaemonMessage,
  type DaemonTransport,
  type DeviceId,
  type RelayEntryFrame,
  type RelayServerFrame,
  type Unsubscribe,
} from "@scorel/protocol";

export type RelayTransportOptions = {
  relayUrl: string;
  deviceId: DeviceId;
  clientId: ClientId;
  createWebSocket?: (url: string) => WebSocketLike;
};

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void, options?: { once?: boolean }): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void, options?: { once?: boolean }): void;
  removeEventListener(type: "error", listener: (event: unknown) => void): void;
};

const websocketOpenState = 1;

export class RelayTransport implements DaemonTransport {
  readonly relayUrl: string;
  readonly deviceId: DeviceId;
  readonly clientId: ClientId;
  readonly #createWebSocket: (url: string) => WebSocketLike;
  readonly #handlers = new Set<(message: DaemonMessage) => void>();
  #socket: WebSocketLike | undefined;

  constructor(options: RelayTransportOptions) {
    this.relayUrl = options.relayUrl;
    this.deviceId = options.deviceId;
    this.clientId = options.clientId;
    this.#createWebSocket =
      options.createWebSocket ??
      ((url) => {
        if (typeof WebSocket === "undefined") {
          throw new Error("WebSocket is not available in this runtime");
        }
        return new WebSocket(url);
      });
  }

  connect(params: ConnectParams): Promise<ConnectResult> {
    return new Promise((resolve, reject) => {
      const socket = this.#createWebSocket(this.relayUrl);
      this.#socket = socket;
      const rejectOnError = (event: unknown) => {
        socket.removeEventListener("error", rejectOnError);
        reject(event instanceof Error ? event : new Error("Relay WebSocket connection failed"));
      };
      socket.addEventListener("error", rejectOnError, { once: true });
      socket.addEventListener("message", (event) => {
        const frame = parseRelayFrame(event.data);
        if (frame.type === "relay_error") {
          reject(new Error(frame.message));
          return;
        }
        if (frame.type !== "device_to_entry") {
          return;
        }
        this.#emit(frame.payload);
        if (frame.payload.type === "connected") {
          socket.removeEventListener("error", rejectOnError);
          resolve({
            clientId: frame.payload.clientId,
            sessionId: frame.payload.sessionId,
            currentSeq: frame.payload.currentSeq,
            deviceId: frame.payload.deviceId,
            deviceDisplayName: frame.payload.deviceDisplayName,
          });
        }
      });
      socket.addEventListener(
        "open",
        () => {
          this.#write({ type: "entry_hello", clientId: this.clientId });
          this.#write({
            type: "entry_to_device",
            deviceId: this.deviceId,
            payload: { type: "connect", ...params },
          });
        },
        { once: true },
      );
    });
  }

  send(message: ClientMessage): void {
    this.#write({
      type: "entry_to_device",
      deviceId: this.deviceId,
      payload: message,
    });
  }

  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  close(): void {
    this.#socket?.close();
    this.#socket = undefined;
    this.#handlers.clear();
  }

  #write(frame: RelayEntryFrame): void {
    if (!this.#socket || this.#socket.readyState !== websocketOpenState) {
      throw new Error("RelayTransport is not connected");
    }
    this.#socket.send(JSON.stringify(frame));
  }

  #emit(message: DaemonMessage): void {
    for (const handler of this.#handlers) {
      handler(message);
    }
  }
}

const parseRelayFrame = (data: unknown): RelayServerFrame => {
  const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data);
  return JSON.parse(text) as RelayServerFrame;
};
