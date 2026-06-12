const DEFAULT_QQ_API_BASE_URL = "https://api.sgroup.qq.com";
const DEFAULT_QQ_ACCESS_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

export const createAdapter = ({ config = {} } = {}) => {
  return createQQAdapter({
    appId: requiredStringConfig(config.appId, "QQ App ID"),
    appSecret: requiredStringConfig(config.appSecret, "QQ App Secret"),
    apiBaseUrl: stringConfig(config.apiBaseUrl, DEFAULT_QQ_API_BASE_URL),
    accessTokenUrl: stringConfig(config.accessTokenUrl, DEFAULT_QQ_ACCESS_TOKEN_URL),
    botId: optionalStringConfig(config.botId, "QQ botId"),
  });
};

export const createQQAdapter = (options) => {
  let accessToken;
  let accessTokenExpiresAt = 0;

  const getAccessToken = async () => {
    const refreshAt = accessTokenExpiresAt - 60_000;
    if (accessToken && Date.now() < refreshAt) {
      return accessToken;
    }
    const response = await fetch(options.accessTokenUrl ?? DEFAULT_QQ_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: options.appId,
        clientSecret: options.appSecret,
      }),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token.trim()) {
      throw new Error(redactQQSecret(`qq access token failed: ${payload?.message ?? payload?.errmsg ?? response.status}`));
    }
    const expiresIn = Number(payload.expires_in);
    accessToken = payload.access_token.trim();
    accessTokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 7200_000);
    return accessToken;
  };

  return {
    async start() {
      // QQ Bot receives through the official gateway/webhook surface. Scorel's
      // Host bridge owns session routing; this adapter keeps platform IO narrow.
    },
    async stop() {
      // No persistent resource in the REST-only V1 adapter.
    },
    async sendMessage(target, message) {
      rejectUnsupportedAttachments("QQ", message);
      const route = qqSendRoute(target);
      await qqRequest(options, route, await getAccessToken(), {
        msg_type: 0,
        content: String(message.text).trim(),
        ...(target?.data?.messageId ? { msg_id: target.data.messageId } : {}),
        msg_seq: 1,
      });
    },
  };
};

export const normalizeQQEvent = (event, options = {}) => {
  const text = typeof event?.content === "string" ? event.content.trim() : "";
  if (!text) {
    return undefined;
  }
  const groupOpenId = optionalEventString(event.group_openid);
  const userOpenId = optionalEventString(event.user_openid ?? event.author?.user_openid ?? event.author?.id);
  const channelId = optionalEventString(event.channel_id);
  const guildId = optionalEventString(event.guild_id);
  const messageId = optionalEventString(event.id);
  const mentionedBot = isQQBotMentioned(text, options.botId) || Boolean(groupOpenId || guildId);
  if (groupOpenId) {
    return qqIncoming({
      kind: "group",
      id: groupOpenId,
      text: stripQQMention(text, options.botId),
      senderDisplayName: senderDisplayName(event.author ?? event.member),
      mentionedBot,
      messageId,
    });
  }
  if (userOpenId) {
    return qqIncoming({
      kind: "private",
      id: userOpenId,
      text,
      senderDisplayName: senderDisplayName(event.author),
      mentionedBot: false,
      messageId,
    });
  }
  if (channelId) {
    return qqIncoming({
      kind: "channel",
      id: channelId,
      text: stripQQMention(text, options.botId),
      senderDisplayName: senderDisplayName(event.author ?? event.member),
      mentionedBot,
      messageId,
      extraData: guildId ? { guildId } : {},
    });
  }
  return undefined;
};

export const redactQQSecret = (value) =>
  String(value)
    .replace(/(clientSecret"\s*:\s*")[^"]+/g, "$1[REDACTED]")
    .replace(/QQBot\s+[A-Za-z0-9._-]+/g, "QQBot [REDACTED]");

const qqIncoming = ({ kind, id, text, senderDisplayName, mentionedBot, messageId, extraData = {} }) => {
  const conversationType = kind === "private" ? "private" : kind;
  const externalConversationId = `qq:${conversationType}:${id}`;
  return {
    externalConversationId,
    text,
    conversationType,
    senderDisplayName,
    mentionedBot,
    target: {
      externalConversationId,
      data: { kind, id, ...(messageId ? { messageId } : {}), ...extraData },
    },
    data: {
      ...(messageId ? { messageId } : {}),
      ...extraData,
    },
  };
};

const qqSendRoute = (target) => {
  const kind = target?.data?.kind;
  const id = target?.data?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("QQ target is missing id");
  }
  if (kind === "group") {
    return `/v2/groups/${encodeURIComponent(id)}/messages`;
  }
  if (kind === "private") {
    return `/v2/users/${encodeURIComponent(id)}/messages`;
  }
  if (kind === "channel") {
    return `/channels/${encodeURIComponent(id)}/messages`;
  }
  throw new Error("QQ target kind must be group, private, or channel");
};

const qqRequest = async (options, route, accessToken, body) => {
  const response = await fetch(`${options.apiBaseUrl.replace(/\/+$/, "")}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `QQBot ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(redactQQSecret(`qq send failed: ${payload?.message ?? response.status}`));
  }
  return payload;
};

const isQQBotMentioned = (text, botId) =>
  Boolean(botId && new RegExp(`<@!?${escapeRegExp(botId)}>`, "i").test(text));

const stripQQMention = (text, botId) => {
  if (!botId) {
    return text.trim();
  }
  return text.replace(new RegExp(`<@!?${escapeRegExp(botId)}>`, "gi"), " ").trim();
};

const senderDisplayName = (value) => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return optionalEventString(value.username ?? value.nick ?? value.name);
};

const optionalEventString = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;

const requiredStringConfig = (value, name) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

const stringConfig = (value, fallback) => {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error("QQ config value must be a string");
  }
  return value;
};

const optionalStringConfig = (value, name) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

const rejectUnsupportedAttachments = (platform, message) => {
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    throw new Error(`${platform} attachment sending is not supported yet`);
  }
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
