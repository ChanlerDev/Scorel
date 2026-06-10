const DEFAULT_POLL_INTERVAL_MS = 1000;
const TELEGRAM_MESSAGE_LIMIT = 4096;

export const createAdapter = ({ config = {} } = {}) => {
  const directToken = optionalStringConfig(config.apiKey ?? config.botToken, "Telegram direct API key");
  const tokenEnv = stringConfig(config.botTokenEnv, "SCOREL_TELEGRAM_BOT_TOKEN");
  const token = directToken ?? process.env[tokenEnv];
  if (!token) {
    throw new Error(`${tokenEnv} is not set`);
  }
  return createTelegramAdapter({
    token,
    apiBaseUrl: stringConfig(config.apiBaseUrl, "https://api.telegram.org"),
    pollIntervalMs: numberConfig(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS),
    allowedChatIds: parseAllowedChatIds(config.allowedChatIds),
    botUsername: typeof config.botUsername === "string" ? config.botUsername : undefined,
  });
};

export const createTelegramAdapter = (options) => {
  const state = {
    running: false,
    offset: undefined,
    timer: undefined,
    ctx: undefined,
    botUsername: options.botUsername,
  };

  const request = async (method, body) => telegramRequest(options.apiBaseUrl, options.token, method, body);

  const pollOnce = async () => {
    if (!state.running || !state.ctx) {
      return;
    }
    try {
      if (!state.botUsername) {
        const me = await request("getMe", {});
        state.botUsername = typeof me?.username === "string" ? me.username : undefined;
      }
      const updates = await request("getUpdates", {
        timeout: 0,
        ...(state.offset !== undefined ? { offset: state.offset } : {}),
      });
      if (!Array.isArray(updates)) {
        return;
      }
      for (const update of updates) {
        if (typeof update?.update_id === "number") {
          state.offset = update.update_id + 1;
        }
        const incoming = normalizeTelegramUpdate(update, {
          botUsername: state.botUsername,
          allowedChatIds: options.allowedChatIds ?? [],
        });
        if (!incoming) {
          continue;
        }
        await state.ctx.onMessage(incoming);
      }
    } catch (cause) {
      state.ctx.logger.error("telegram_poll_failed", { message: safeErrorMessage(cause) });
    }
  };

  const scheduleNextPoll = () => {
    if (!state.running) {
      return;
    }
    state.timer = setTimeout(() => {
      void pollOnce().finally(scheduleNextPoll);
    }, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    state.timer.unref?.();
  };

  return {
    async start(ctx) {
      state.ctx = ctx;
      state.running = true;
      await pollOnce();
      scheduleNextPoll();
    },
    async stop() {
      state.running = false;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
    },
    async sendMessage(target, message) {
      const chatId = target?.data?.chatId;
      if (chatId === undefined || chatId === null) {
        throw new Error("telegram target is missing chatId");
      }
      for (const text of splitTelegramText(message.text)) {
        await request("sendMessage", { chat_id: chatId, text });
      }
    },
    async setTyping(target, typing) {
      if (!typing) {
        return;
      }
      const chatId = target?.data?.chatId;
      if (chatId === undefined || chatId === null) {
        return;
      }
      await request("sendChatAction", { chat_id: chatId, action: "typing" });
    },
  };
};

export const normalizeTelegramUpdate = (update, options = {}) => {
  const message = update?.message;
  if (!message || typeof message !== "object") {
    return undefined;
  }
  if (typeof message.text !== "string" || message.text.trim().length === 0) {
    return undefined;
  }
  const chat = message.chat;
  if (!chat || typeof chat.id !== "number") {
    return undefined;
  }
  const allowedChatIds = options.allowedChatIds ?? [];
  if (allowedChatIds.length > 0 && !allowedChatIds.includes(String(chat.id))) {
    return undefined;
  }
  const conversationType = telegramConversationType(chat.type);
  const mentionedBot = isBotMentioned(message, options.botUsername);
  if ((conversationType === "group" || conversationType === "supergroup") && !mentionedBot) {
    return undefined;
  }
  return {
    externalConversationId: `telegram:${conversationType}:${chat.id}`,
    text: stripBotMention(message.text, options.botUsername),
    conversationType,
    senderDisplayName: senderDisplayName(message.from),
    mentionedBot,
    target: {
      externalConversationId: `telegram:${conversationType}:${chat.id}`,
      data: { chatId: chat.id },
    },
    data: {
      messageId: message.message_id,
      chatType: chat.type,
    },
  };
};

export const isBotMentioned = (message, botUsername) => {
  const text = typeof message?.text === "string" ? message.text : "";
  if (botUsername && new RegExp(`(^|\\s)@${escapeRegExp(botUsername)}\\b`, "i").test(text)) {
    return true;
  }
  const replyUsername = message?.reply_to_message?.from?.username;
  return Boolean(botUsername && typeof replyUsername === "string" && replyUsername.toLowerCase() === botUsername.toLowerCase());
};

export const splitTelegramText = (text) => {
  const normalized = String(text).trim();
  if (normalized.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [normalized];
  }
  const chunks = [];
  for (let index = 0; index < normalized.length; index += TELEGRAM_MESSAGE_LIMIT) {
    chunks.push(normalized.slice(index, index + TELEGRAM_MESSAGE_LIMIT));
  }
  return chunks;
};

export const parseAllowedChatIds = (value) => {
  if (value === undefined || value === "") {
    return [];
  }
  if (typeof value === "number") {
    return [String(value)];
  }
  if (typeof value !== "string") {
    throw new Error("allowedChatIds must be a comma-separated string");
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
};

const telegramRequest = async (apiBaseUrl, token, method, body) => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`telegram ${method} failed: ${payload?.description ?? response.status}`);
  }
  return payload.result;
};

const telegramConversationType = (type) => {
  if (type === "group" || type === "supergroup" || type === "private") {
    return type;
  }
  return "group";
};

const senderDisplayName = (from) => {
  if (!from || typeof from !== "object") {
    return undefined;
  }
  return [from.first_name, from.last_name].filter((part) => typeof part === "string" && part.trim()).join(" ") ||
    (typeof from.username === "string" ? from.username : undefined);
};

const stripBotMention = (text, botUsername) => {
  if (!botUsername) {
    return text.trim();
  }
  return text.replace(new RegExp(`(^|\\s)@${escapeRegExp(botUsername)}\\b`, "i"), " ").trim();
};

const stringConfig = (value, fallback) => {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error("Telegram config value must be a string");
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
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Telegram numeric config value must be non-negative");
  }
  return value;
};

const safeErrorMessage = (cause) => cause instanceof Error ? redactToken(cause.message) : redactToken(String(cause));

export const redactToken = (value) => value.replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot[REDACTED]");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
