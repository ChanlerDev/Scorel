import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { request } from "node:http";
import { createHash } from "node:crypto";

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
    expect(() => createAdapter()).toThrow("WeChat webhook URL or callback token is required");
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

  it("starts an HTTP callback server for verification and inbound text messages", async () => {
    const received: unknown[] = [];
    const adapter = createWeChatAdapter({
      callbackHost: "127.0.0.1",
      callbackPort: 0,
      callbackToken: "callback_token",
    });

    try {
      await adapter.start({
        onMessage: async (message: unknown) => {
          received.push(message);
        },
        logger: {
          info: () => undefined,
          error: () => undefined,
        },
      });
      const callbackUrl = adapter.callbackUrl?.();
      expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/wechat\/callback$/);

      const timestamp = "1710000000";
      const nonce = "nonce_1";
      const echostr = "verify_echo";
      const signature = wechatSignature("callback_token", timestamp, nonce);
      const verify = await httpRequest(`${callbackUrl}?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=${echostr}`);
      expect(verify).toMatchObject({ status: 200, body: echostr });

      const xml = [
        "<xml>",
        "<ToUserName><![CDATA[to_user]]></ToUserName>",
        "<FromUserName><![CDATA[openid_123]]></FromUserName>",
        "<CreateTime>1710000001</CreateTime>",
        "<MsgType><![CDATA[text]]></MsgType>",
        "<Content><![CDATA[hello wechat]]></Content>",
        "<MsgId>msg_1</MsgId>",
        "</xml>",
      ].join("");
      const postSignature = wechatSignature("callback_token", "1710000001", "nonce_2");
      const post = await httpRequest(`${callbackUrl}?signature=${postSignature}&timestamp=1710000001&nonce=nonce_2`, {
        method: "POST",
        body: xml,
        headers: { "content-type": "text/xml" },
      });
      expect(post).toMatchObject({ status: 200, body: "success" });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        externalConversationId: "wechat:official:openid_123",
        text: "hello wechat",
        target: {
          data: { kind: "official", id: "openid_123", messageId: "msg_1" },
        },
      });
    } finally {
      await adapter.stop();
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

const wechatSignature = (token: string, timestamp: string, nonce: string): string => {
  return createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
};

const httpRequest = async (
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = request(url, {
      method: options.method ?? "GET",
      headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
