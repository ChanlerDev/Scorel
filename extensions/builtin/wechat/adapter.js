export const createAdapter = ({ config = {} } = {}) => {
  return createWeChatAdapter({
    webhookUrl: requiredStringConfig(config.webhookUrl, "WeChat webhook URL"),
  });
};

export const createWeChatAdapter = (options) => ({
  async start() {
    // Incoming WeChat/WeCom callbacks are normalized by normalizeWeChatEvent;
    // V1 keeps HTTP ingress outside the adapter so Host routing remains shared.
  },
  async stop() {
    // No persistent resource in the webhook sender.
  },
  async sendMessage(_target, message) {
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
});

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
  String(value).replace(/([?&]key=)[^&\s]+/g, "$1[REDACTED]");

const optionalEventString = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;

const requiredStringConfig = (value, name) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};
