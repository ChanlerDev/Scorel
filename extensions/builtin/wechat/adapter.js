import { createHash } from "node:crypto";
import { createServer } from "node:http";

export const createAdapter = ({ config = {} } = {}) => {
  return createWeChatAdapter({
    webhookUrl: optionalStringConfig(config.webhookUrl, "WeChat webhook URL"),
    callbackHost: stringConfig(config.callbackHost, "127.0.0.1"),
    callbackPort: numberConfig(config.callbackPort, undefined),
    callbackPath: stringConfig(config.callbackPath, "/wechat/callback"),
    callbackToken: optionalStringConfig(config.callbackToken, "WeChat callback token"),
  });
};

export const createWeChatAdapter = (options) => {
  if (!options.webhookUrl && !options.callbackToken) {
    throw new Error("WeChat webhook URL or callback token is required");
  }
  let server;
  let ctx;
  let callbackPort;

  return {
    async start(startCtx) {
      ctx = startCtx;
      if (!options.callbackToken) {
        ctx?.logger?.info("wechat_callback_not_configured", {});
        return;
      }
      server = createServer((request, response) => {
        void handleCallbackRequest(options, request, response, ctx).catch((cause) => {
          ctx?.logger?.error("wechat_callback_failed", { message: redactWeChatSecret(safeErrorMessage(cause)) });
          if (!response.headersSent) {
            response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          }
          response.end("error");
        });
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.once("listening", () => {
          server.off("error", reject);
          resolve();
        });
        server.listen(options.callbackPort ?? 0, options.callbackHost ?? "127.0.0.1");
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("WeChat callback server did not expose a TCP address");
      }
      callbackPort = address.port;
      ctx?.logger?.info("wechat_callback_started", { url: callbackUrl(options, callbackPort) });
    },
    async stop() {
      const closing = server;
      server = undefined;
      callbackPort = undefined;
      if (closing) {
        await new Promise((resolve, reject) => closing.close((error) => error ? reject(error) : resolve()));
      }
    },
    callbackUrl() {
      return callbackPort ? callbackUrl(options, callbackPort) : undefined;
    },
    async sendMessage(_target, message) {
      rejectUnsupportedAttachments("WeChat", message);
      if (!options.webhookUrl) {
        throw new Error("WeChat outbound webhook URL is not configured");
      }
      const response = await fetch(options.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: String(message.text).trim() },
        }),
      });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok || (payload?.errcode !== undefined && payload.errcode !== 0)) {
        throw new Error(redactWeChatSecret(`wechat send failed: ${payload?.errmsg ?? response.status}`));
      }
    },
  };
};

export const normalizeWeChatEvent = (event) => {
  const text = typeof event?.Content === "string" ? event.Content.trim() : "";
  if (!text || event?.MsgType !== "text") {
    return undefined;
  }
  const openId = optionalEventString(event.FromUserName);
  if (!openId) {
    return undefined;
  }
  const messageId = optionalEventString(event.MsgId);
  const externalConversationId = `wechat:official:${openId}`;
  return {
    externalConversationId,
    text,
    conversationType: "official",
    mentionedBot: true,
    target: {
      externalConversationId,
      data: { kind: "official", id: openId, ...(messageId ? { messageId } : {}) },
    },
    data: {
      ...(messageId ? { messageId } : {}),
    },
  };
};

export const redactWeChatSecret = (value) =>
  String(value)
    .replace(/([?&]key=)[^&\s]+/g, "$1[REDACTED]")
    .replace(/(callbackToken"\s*:\s*")[^"]+/g, "$1[REDACTED]");

const handleCallbackRequest = async (options, request, response, ctx) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== (options.callbackPath ?? "/wechat/callback")) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const signature = url.searchParams.get("signature") ?? "";
  if (!verifySignature(options.callbackToken, timestamp, nonce, signature)) {
    response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    response.end("invalid signature");
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(url.searchParams.get("echostr") ?? "");
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("method not allowed");
    return;
  }
  const event = parseWeChatXml(await readText(request));
  const incoming = normalizeWeChatEvent(event);
  if (incoming) {
    await ctx?.onMessage(incoming);
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("success");
};

const optionalEventString = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;

const requiredStringConfig = (value, name) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

const optionalStringConfig = (value, name) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value.trim();
};

const stringConfig = (value, fallback) => {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error("WeChat config value must be a string");
  }
  return value.trim();
};

const numberConfig = (value, fallback) => {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error("WeChat callback port must be a valid TCP port");
  }
  return parsed;
};

const callbackUrl = (options, port) =>
  `http://${options.callbackHost ?? "127.0.0.1"}:${port}${options.callbackPath ?? "/wechat/callback"}`;

const verifySignature = (token, timestamp, nonce, signature) => {
  if (!token || !timestamp || !nonce || !signature) {
    return false;
  }
  const expected = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  return expected === signature;
};

const readText = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseWeChatXml = (xml) => {
  const result = {};
  for (const key of ["ToUserName", "FromUserName", "CreateTime", "MsgType", "Content", "MsgId"]) {
    const match = new RegExp(`<${key}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${key}>`).exec(xml);
    if (match) {
      result[key] = (match[1] ?? match[2] ?? "").trim();
    }
  }
  return result;
};

const safeErrorMessage = (cause) => cause instanceof Error ? cause.message : String(cause);

const rejectUnsupportedAttachments = (platform, message) => {
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    throw new Error(`${platform} attachment sending is not supported yet`);
  }
};
