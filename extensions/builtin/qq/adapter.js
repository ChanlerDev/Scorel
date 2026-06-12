import WebSocket from "ws";

const DEFAULT_QQ_API_BASE_URL = "https://api.sgroup.qq.com";
const DEFAULT_QQ_ACCESS_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const DEFAULT_QQ_INTENTS = (1 << 9) | (1 << 25) | (1 << 30);
const DEFAULT_DEDUPE_TTL_MS = 5 * 60_000;

export const createAdapter = ({ config = {} } = {}) => {
  return createQQAdapter({
    appId: requiredStringConfig(config.appId, "QQ App ID"),
    appSecret: requiredStringConfig(config.appSecret, "QQ App Secret"),
    apiBaseUrl: stringConfig(config.apiBaseUrl, DEFAULT_QQ_API_BASE_URL),
    accessTokenUrl: stringConfig(config.accessTokenUrl, DEFAULT_QQ_ACCESS_TOKEN_URL),
    gatewayUrl: stringConfig(config.gatewayUrl, ""),
    botId: optionalStringConfig(config.botId, "QQ botId"),
  });
};

export const createQQAdapter = (options) => {
  let accessToken;
  let accessTokenExpiresAt = 0;
  let ctx;
  let running = false;
  let socket;
  let heartbeatTimer;
  let lastSequence = null;
  let sessionId;
  const recentMessageIds = new Map();

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

  const fetchGatewayUrl = async (token) => {
    const configured = typeof options.gatewayUrl === "string" && options.gatewayUrl.trim() ? options.gatewayUrl.trim() : undefined;
    const response = await fetch(configured ?? `${options.apiBaseUrl.replace(/\/+$/, "")}/gateway`, {
      method: "GET",
      headers: { authorization: `QQBot ${token}` },
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || typeof payload?.url !== "string" || !payload.url.trim()) {
      throw new Error(redactQQSecret(`qq gateway failed: ${payload?.message ?? response.status}`));
    }
    return payload.url.trim();
  };

  const sendSocket = (payload) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  };

  const sendHeartbeat = () => {
    sendSocket({ op: 1, d: lastSequence });
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const identify = async () => {
    sendSocket({
      op: 2,
      d: {
        token: `QQBot ${await getAccessToken()}`,
        intents: numberConfig(options.intents, DEFAULT_QQ_INTENTS),
        shard: Array.isArray(options.shard) ? options.shard : [0, 1],
        properties: {
          "$os": process.platform,
          "$browser": "scorel",
          "$device": "scorel",
        },
      },
    });
  };

  const handleGatewayPayload = async (payload) => {
    if (typeof payload?.s === "number") {
      lastSequence = payload.s;
    }
    if (payload?.op === 10) {
      const interval = numberConfig(options.heartbeatIntervalMs, Number(payload?.d?.heartbeat_interval) || 45_000);
      clearHeartbeat();
      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, interval);
      heartbeatTimer.unref?.();
      await identify();
      return;
    }
    if (payload?.op === 1) {
      sendHeartbeat();
      return;
    }
    if (payload?.op === 0) {
      if (payload.t === "READY" && typeof payload.d?.session_id === "string") {
        sessionId = payload.d.session_id;
        return;
      }
      const incoming = normalizeQQEvent(payload.d, { botId: options.botId });
      if (!incoming || isDuplicateMessage(incoming, recentMessageIds, numberConfig(options.dedupeTtlMs, DEFAULT_DEDUPE_TTL_MS))) {
        return;
      }
      await ctx?.onMessage(incoming);
      return;
    }
    if (payload?.op === 7 || payload?.op === 9) {
      ctx?.logger?.error("qq_gateway_reconnect_required", { op: payload.op, sessionId });
    }
  };

  return {
    async start(startCtx) {
      ctx = startCtx;
      running = true;
      const token = await getAccessToken();
      const url = await fetchGatewayUrl(token);
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        socket = ws;
        let settled = false;
        const settle = (error) => {
          if (settled) return;
          settled = true;
          error ? reject(error) : resolve();
        };
        ws.once("open", () => settle());
        ws.once("error", (error) => {
          ctx?.logger?.error("qq_gateway_error", { message: safeErrorMessage(error) });
          settle(error);
        });
        ws.on("message", (data) => {
          void handleGatewayPayload(parseGatewayMessage(data)).catch((cause) => {
            ctx?.logger?.error("qq_gateway_message_failed", { message: redactQQSecret(safeErrorMessage(cause)) });
          });
        });
        ws.on("close", () => {
          clearHeartbeat();
          if (running) {
            ctx?.logger?.error("qq_gateway_closed", {});
          }
        });
      });
    },
    async stop() {
      running = false;
      clearHeartbeat();
      const closing = socket;
      socket = undefined;
      if (closing && closing.readyState !== WebSocket.CLOSED) {
        await new Promise((resolve) => {
          closing.once("close", () => resolve());
          closing.close();
          setTimeout(resolve, 250).unref?.();
        });
      }
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

const parseGatewayMessage = (data) => {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  return JSON.parse(text);
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

const numberConfig = (value, fallback) => {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("QQ config value must be a positive number");
  }
  return parsed;
};

const isDuplicateMessage = (incoming, recentMessageIds, ttlMs) => {
  const messageId = optionalEventString(incoming?.data?.messageId ?? incoming?.target?.data?.messageId);
  if (!messageId) {
    return false;
  }
  const now = Date.now();
  for (const [id, expiresAt] of recentMessageIds) {
    if (expiresAt <= now) {
      recentMessageIds.delete(id);
    }
  }
  if (recentMessageIds.has(messageId)) {
    return true;
  }
  recentMessageIds.set(messageId, now + ttlMs);
  return false;
};

const safeErrorMessage = (cause) => cause instanceof Error ? cause.message : String(cause);

const rejectUnsupportedAttachments = (platform, message) => {
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    throw new Error(`${platform} attachment sending is not supported yet`);
  }
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
