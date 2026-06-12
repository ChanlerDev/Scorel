export type TelegramAdapterOptions = {
  token: string;
  apiBaseUrl: string;
  pollIntervalMs?: number;
  allowedChatIds?: string[];
  botUsername?: string;
};

export type TelegramIncomingMessage = {
  externalConversationId: string;
  text: string;
  conversationType?: string;
  senderDisplayName?: string;
  mentionedBot?: boolean;
  target?: TelegramTarget;
  data?: Record<string, unknown>;
};

export type TelegramTarget = {
  externalConversationId: string;
  data?: Record<string, unknown>;
};

export type TelegramAdapter = {
  start(ctx: {
    onMessage(message: TelegramIncomingMessage): Promise<void>;
    logger: {
      info(message: string, data?: Record<string, unknown>): void;
      error(message: string, data?: Record<string, unknown>): void;
    };
  }): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: TelegramTarget, message: { text?: string; attachments?: Array<Record<string, unknown>> }): Promise<void>;
  setTyping?(target: TelegramTarget, typing: boolean): Promise<void>;
};

export function createAdapter(options?: { config?: Record<string, string | number | boolean> }): TelegramAdapter;
export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter;
export function normalizeTelegramUpdate(update: unknown, options?: { botUsername?: string; allowedChatIds?: string[] }): unknown;
export function isBotMentioned(message: unknown, botUsername?: string): boolean;
export function splitTelegramText(text: string): string[];
export function parseAllowedChatIds(value: unknown): string[];
export function redactToken(value: string): string;
