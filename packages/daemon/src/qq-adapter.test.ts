import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import {
  createAdapter,
  createQQAdapter,
  normalizeQQEvent,
  redactQQSecret,
} from "../../../extensions/builtin/qq/adapter.js";

describe("QQ Bot IM adapter", () => {
  it("normalizes group and private text events", () => {
    expect(normalizeQQEvent({
      id: "msg_group_1",
      content: "<@!bot_1> run tests",
      group_openid: "group_123",
      author: { username: "Chanler" },
    }, { botId: "bot_1" })).toMatchObject({
      externalConversationId: "qq:group:group_123",
      text: "run tests",
      conversationType: "group",
      senderDisplayName: "Chanler",
      mentionedBot: true,
      target: {
        externalConversationId: "qq:group:group_123",
        data: { kind: "group", id: "group_123", messageId: "msg_group_1" },
      },
    });

    expect(normalizeQQEvent({
      id: "msg_private_1",
      content: "hello",
      user_openid: "user_123",
      author: { username: "Chanler" },
    })).toMatchObject({
      externalConversationId: "qq:private:user_123",
      text: "hello",
      conversationType: "private",
      mentionedBot: false,
      target: {
        data: { kind: "private", id: "user_123", messageId: "msg_private_1" },
      },
    });
  });

  it("requires App ID and App Secret and redacts bearer tokens", () => {
    expect(() => createAdapter({ config: { appId: "app_1" } })).toThrow("QQ App Secret is required");
    expect(() => createAdapter({ config: { appSecret: "secret_1" } })).toThrow("QQ App ID is required");
    expect(redactQQSecret("Authorization QQBot access_token")).toBe("Authorization QQBot [REDACTED]");
  });

  it("fetches an access token and sends group and private text messages through a local API stub", async () => {
    const requests: Array<{ url: string; body: unknown; authorization: string | undefined }> = [];
    const server = await startJsonStub(async (request, body) => {
      requests.push({ url: request.url ?? "", body, authorization: request.headers.authorization });
      if (request.url === "/app/getAppAccessToken") {
        return { access_token: "access_token_1", expires_in: 7200 };
      }
      return { id: "sent" };
    });

    try {
      const adapter = createQQAdapter({
        appId: "app_1",
        appSecret: "secret_1",
        apiBaseUrl: server.url,
        accessTokenUrl: `${server.url}/app/getAppAccessToken`,
      });
      await adapter.sendMessage(
        { externalConversationId: "qq:group:group_123", data: { kind: "group", id: "group_123", messageId: "msg_1" } },
        { text: "hello group" },
      );
      await adapter.sendMessage(
        { externalConversationId: "qq:private:user_123", data: { kind: "private", id: "user_123", messageId: "msg_2" } },
        { text: "hello user" },
      );

      expect(requests).toHaveLength(3);
      expect(requests[0]).toMatchObject({
        url: "/app/getAppAccessToken",
        body: { appId: "app_1", clientSecret: "secret_1" },
      });
      expect(requests[1]).toMatchObject({
        url: "/v2/groups/group_123/messages",
        authorization: "QQBot access_token_1",
        body: { msg_type: 0, content: "hello group", msg_id: "msg_1", msg_seq: 1 },
      });
      expect(requests[2]).toMatchObject({
        url: "/v2/users/user_123/messages",
        authorization: "QQBot access_token_1",
        body: { msg_type: 0, content: "hello user", msg_id: "msg_2", msg_seq: 1 },
      });
    } finally {
      await server.close();
    }
  });

  it("connects to the official gateway shape and routes dispatch messages", async () => {
    const gateway = await startQQGatewayStub();
    const requests: Array<{ url: string; body: unknown; authorization: string | undefined }> = [];
    const api = await startJsonStub(async (request, body) => {
      requests.push({ url: request.url ?? "", body, authorization: request.headers.authorization });
      if (request.url === "/app/getAppAccessToken") {
        return { access_token: "access_token_1", expires_in: 7200 };
      }
      if (request.url === "/gateway") {
        return { url: gateway.url };
      }
      return { id: "sent" };
    });

    try {
      const received: unknown[] = [];
      const adapter = createQQAdapter({
        appId: "app_1",
        appSecret: "secret_1",
        apiBaseUrl: api.url,
        accessTokenUrl: `${api.url}/app/getAppAccessToken`,
        gatewayUrl: `${api.url}/gateway`,
        botId: "bot_1",
        heartbeatIntervalMs: 10_000,
      });

      await adapter.start({
        onMessage: async (message: unknown) => {
          received.push(message);
        },
        logger: {
          info: () => undefined,
          error: () => undefined,
        },
      });
      await waitFor(() => gateway.sent.some((message) => message.op === 2));
      expect(gateway.sent.find((message) => message.op === 2)).toMatchObject({
        op: 2,
        d: {
          token: "QQBot access_token_1",
          intents: expect.any(Number),
          shard: [0, 1],
        },
      });

      gateway.dispatch({
        op: 0,
        s: 1,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg_group_1",
          content: "<@!bot_1> hello from qq",
          group_openid: "group_123",
          author: { username: "Chanler" },
        },
      });
      await waitFor(() => received.length === 1);
      expect(received[0]).toMatchObject({
        externalConversationId: "qq:group:group_123",
        text: "hello from qq",
        target: {
          data: { kind: "group", id: "group_123", messageId: "msg_group_1" },
        },
      });

      await adapter.stop();
      await waitFor(() => gateway.closed);
      expect(gateway.closed).toBe(true);
    } finally {
      await api.close();
      await gateway.close();
    }
  });
});

const startJsonStub = async (
  handler: (request: IncomingMessage, body: unknown) => Promise<unknown>,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJson(request);
    const payload = await handler(request, body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("QQ stub did not bind to a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

type QQGatewayPayload = { op: number; d?: unknown; s?: number; t?: string };

const startQQGatewayStub = async (): Promise<{
  url: string;
  sent: QQGatewayPayload[];
  closed: boolean;
  dispatch: (payload: QQGatewayPayload) => void;
  close: () => Promise<void>;
}> => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const sent: QQGatewayPayload[] = [];
  let client: import("ws").WebSocket | undefined;
  let closed = false;
  server.on("connection", (socket) => {
    client = socket;
    socket.on("message", (data) => {
      sent.push(JSON.parse(String(data)) as QQGatewayPayload);
    });
    socket.on("close", () => {
      closed = true;
    });
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 10_000 } }));
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("QQ gateway stub did not bind to a TCP port");
  }
  return {
    url: `ws://127.0.0.1:${address.port}`,
    sent,
    get closed() {
      return closed;
    },
    dispatch: (payload) => {
      client?.send(JSON.stringify(payload));
    },
    close: async () => {
      client?.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
