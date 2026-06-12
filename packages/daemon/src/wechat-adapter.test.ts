import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  createAdapter,
  createWeChatAdapter,
  normalizeWeChatEvent,
  redactWeChatSecret,
} from "../../../extensions/builtin/wechat/adapter.js";

describe("WeChat IM adapter", () => {
  it("normalizes official account style text events", () => {
    expect(normalizeWeChatEvent({
      MsgId: "msg_1",
      MsgType: "text",
      Content: "hello",
      FromUserName: "openid_123",
    })).toMatchObject({
      externalConversationId: "wechat:official:openid_123",
      text: "hello",
      conversationType: "official",
      mentionedBot: true,
      target: {
        externalConversationId: "wechat:official:openid_123",
        data: { kind: "official", id: "openid_123", messageId: "msg_1" },
      },
    });
  });

  it("requires a webhook URL and redacts webhook keys", () => {
    expect(() => createAdapter()).toThrow("WeChat webhook URL is required");
    expect(redactWeChatSecret("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-secret"))
      .toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=[REDACTED]");
  });

  it("sends text messages through a WeCom-compatible webhook", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const server = await startJsonStub(async (request, body) => {
      requests.push({ url: request.url ?? "", body });
      return { errcode: 0, errmsg: "ok" };
    });

    try {
      const adapter = createWeChatAdapter({
        webhookUrl: `${server.url}/cgi-bin/webhook/send?key=secret_key`,
      });
      await adapter.sendMessage(
        { externalConversationId: "wechat:wecom:webhook", data: { kind: "wecom-webhook" } },
        { text: "hello wechat" },
      );

      expect(requests).toEqual([{
        url: "/cgi-bin/webhook/send?key=secret_key",
        body: {
          msgtype: "text",
          text: { content: "hello wechat" },
        },
      }]);
    } finally {
      await server.close();
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
    throw new Error("WeChat stub did not bind to a TCP port");
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
