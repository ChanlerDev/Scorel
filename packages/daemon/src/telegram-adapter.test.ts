import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  createAdapter,
  createTelegramAdapter,
  isBotMentioned,
  normalizeTelegramUpdate,
  parseAllowedChatIds,
  redactToken,
} from "../../../extensions/builtin/telegram/adapter.js";

describe("Telegram IM adapter", () => {
  it("normalizes private messages and strips bot mentions", () => {
    expect(normalizeTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        text: "hello",
        chat: { id: 123, type: "private" },
        from: { first_name: "Chanler", last_name: "L" },
      },
    }, { botUsername: "scorel_bot" })).toMatchObject({
      externalConversationId: "telegram:private:123",
      text: "hello",
      conversationType: "private",
      senderDisplayName: "Chanler L",
      mentionedBot: false,
      target: { data: { chatId: 123 } },
    });

    expect(normalizeTelegramUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        text: "@scorel_bot run tests",
        chat: { id: -100, type: "supergroup" },
        from: { username: "chanler" },
      },
    }, { botUsername: "scorel_bot" })).toMatchObject({
      externalConversationId: "telegram:supergroup:-100",
      text: "run tests",
      conversationType: "supergroup",
      senderDisplayName: "chanler",
      mentionedBot: true,
    });
  });

  it("accepts group messages only when mentioned or replied to", () => {
    const groupMessage = {
      update_id: 1,
      message: {
        message_id: 10,
        text: "run tests",
        chat: { id: -100, type: "group" },
        from: { first_name: "Chanler" },
      },
    };

    expect(normalizeTelegramUpdate(groupMessage, { botUsername: "scorel_bot" })).toBeUndefined();
    expect(normalizeTelegramUpdate({
      ...groupMessage,
      message: {
        ...groupMessage.message,
        reply_to_message: { from: { username: "scorel_bot" } },
      },
    }, { botUsername: "scorel_bot" })).toMatchObject({ mentionedBot: true });
    expect(isBotMentioned(groupMessage.message, "scorel_bot")).toBe(false);
  });

  it("parses allowed chat ids and redacts bot tokens", () => {
    expect(parseAllowedChatIds("-100, 123")).toEqual(["-100", "123"]);
    expect(redactToken("telegram https://api.telegram.org/bot123:secret_token/getUpdates failed"))
      .toBe("telegram https://api.telegram.org/bot[REDACTED]/getUpdates failed");
  });

  it("requires the configured token env when the extension is enabled", () => {
    const previous = process.env.SCOREL_TELEGRAM_BOT_TOKEN;
    delete process.env.SCOREL_TELEGRAM_BOT_TOKEN;
    try {
      expect(() => createAdapter()).toThrow("SCOREL_TELEGRAM_BOT_TOKEN is not set");
    } finally {
      if (previous === undefined) {
        delete process.env.SCOREL_TELEGRAM_BOT_TOKEN;
      } else {
        process.env.SCOREL_TELEGRAM_BOT_TOKEN = previous;
      }
    }
  });

  it("accepts a direct apiKey without requiring the token env", () => {
    const previous = process.env.SCOREL_TELEGRAM_BOT_TOKEN;
    delete process.env.SCOREL_TELEGRAM_BOT_TOKEN;
    try {
      expect(() => createAdapter({
        config: {
          apiKey: "123:direct_token",
          apiBaseUrl: "http://127.0.0.1:1",
        },
      })).not.toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.SCOREL_TELEGRAM_BOT_TOKEN;
      } else {
        process.env.SCOREL_TELEGRAM_BOT_TOKEN = previous;
      }
    }
  });

  it("polls Telegram updates and sends messages through a local API stub", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    let getUpdatesCalls = 0;
    const server = await startTelegramStub(async (method, body) => {
      requests.push({ method, body });
      if (method === "getMe") {
        return { ok: true, result: { id: 1, username: "scorel_bot" } };
      }
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        return {
          ok: true,
          result: getUpdatesCalls === 1
            ? [{
                update_id: 100,
                message: {
                  message_id: 20,
                  text: "hello",
                  chat: { id: 123, type: "private" },
                  from: { first_name: "Chanler" },
                },
              }]
            : [],
        };
      }
      if (method === "sendMessage" || method === "sendChatAction") {
        return { ok: true, result: true };
      }
      return { ok: false, description: "unknown method" };
    });

    try {
      const received: unknown[] = [];
      const adapter = createTelegramAdapter({
        token: "123:secret_token",
        apiBaseUrl: server.url,
        pollIntervalMs: 60_000,
      });
      await adapter.start({
        onMessage: async (message) => {
          received.push(message);
        },
        logger: {
          info: () => undefined,
          error: () => undefined,
        },
      });
      await adapter.setTyping?.({ externalConversationId: "telegram:private:123", data: { chatId: 123 } }, true);
      await adapter.sendMessage({ externalConversationId: "telegram:private:123", data: { chatId: 123 } }, { text: "reply" });
      await adapter.stop();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        externalConversationId: "telegram:private:123",
        text: "hello",
      });
      expect(requests.map((request) => request.method)).toEqual(["getMe", "getUpdates", "sendChatAction", "sendMessage"]);
      expect(requests.find((request) => request.method === "sendMessage")?.body).toMatchObject({ chat_id: 123, text: "reply" });
    } finally {
      await server.close();
    }
  });
});

const startTelegramStub = async (
  handler: (method: string, body: unknown) => Promise<{ ok: boolean; result?: unknown; description?: string }>,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const method = request.url?.split("/").at(-1) ?? "";
    const body = await readJson(request);
    const payload = await handler(method, body);
    response.writeHead(payload.ok ? 200 : 400, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("telegram stub did not bind to a TCP port");
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
