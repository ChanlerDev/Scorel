import { connect, type Socket } from "node:net";

import type {
  ClientMessage,
  ConnectParams,
  ConnectResult,
  DaemonMessage,
  DaemonTransport,
  Unsubscribe,
} from "@scorel/protocol";

export const nodeClientEntrypoint = "@scorel/client/node" as const;

export type NodeSocketTransportOptions = {
  path: string;
  token: string;
};

export class NodeSocketTransport implements DaemonTransport {
  readonly path: string;
  readonly #token: string;
  readonly #handlers = new Set<(message: DaemonMessage) => void>();
  #socket: Socket | undefined;
  #buffer = "";

  constructor(options: NodeSocketTransportOptions) {
    this.path = options.path;
    this.#token = options.token;
  }

  connect(params: ConnectParams): Promise<ConnectResult> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.path);
      this.#socket = socket;
      const onError = (error: Error) => {
        socket.off("error", onError);
        reject(error);
      };
      socket.once("error", onError);
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => this.#handleData(chunk.toString()));
      const unsubscribe = this.onMessage((message) => {
        if (message.type !== "connected") {
          return;
        }
        unsubscribe();
        socket.off("error", onError);
        resolve({
          clientId: message.clientId,
          sessionId: message.sessionId,
          currentSeq: message.currentSeq,
        });
      });
      socket.once("connect", () => {
        this.#write({ type: "connect", ...params, token: this.#token });
      });
    });
  }

  send(message: ClientMessage): void {
    this.#write(message);
  }

  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  close(): void {
    this.#socket?.end();
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#handlers.clear();
  }

  #write(message: ClientMessage | (ConnectParams & { type: "connect"; token: string })): void {
    if (!this.#socket) {
      throw new Error("NodeSocketTransport is not connected");
    }
    this.#socket.write(`${JSON.stringify(message)}\n`);
  }

  #handleData(chunk: string): void {
    this.#buffer += chunk;
    while (this.#buffer.includes("\n")) {
      const index = this.#buffer.indexOf("\n");
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line) as DaemonMessage;
      for (const handler of this.#handlers) {
        handler(message);
      }
    }
  }
}
