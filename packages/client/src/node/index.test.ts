import { describe, expect, it } from "vitest";
import { createServer } from "node:net";

import { NodeSocketTransport, nodeClientEntrypoint } from "./index.js";
import { asClientId, type DaemonMessage } from "@scorel/protocol";

describe("@scorel/client/node", () => {
  it("reserves a Node-only socket transport entrypoint", () => {
    const transport = new NodeSocketTransport({ path: "/tmp/scorel-test.sock", token: "local-secret" });

    expect(nodeClientEntrypoint).toBe("@scorel/client/node");
    expect(transport.path).toBe("/tmp/scorel-test.sock");
  });

  it("connects to a local daemon socket and exchanges ping/pong messages", async () => {
    const socketPath = `/tmp/scorel-node-${Date.now()}-${Math.random()}.sock`;
    const messages: DaemonMessage[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          const message = JSON.parse(line) as { type: string; requestId?: string };
          if (message.type === "connect") {
            socket.write(`${JSON.stringify({ type: "connected", clientId: "client_socket", currentSeq: 0 })}\n`);
          }
          if (message.type === "ping") {
            socket.write(`${JSON.stringify({ type: "pong", requestId: message.requestId })}\n`);
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const transport = new NodeSocketTransport({ path: socketPath, token: "local-secret" });

    try {
      transport.onMessage((message) => messages.push(message));
      await transport.connect({ clientId: asClientId("client_socket") });
      const pong = waitForMessage(messages, (message) => message.type === "pong");
      await transport.send({ type: "ping" });

      await expect(pong).resolves.toEqual({ type: "pong" });
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
