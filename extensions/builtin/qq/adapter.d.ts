export type QQAdapterOptions = {
  appId: string;
  appSecret: string;
  apiBaseUrl: string;
  accessTokenUrl?: string;
  botId?: string;
};

export type QQTarget = {
  externalConversationId: string;
  data?: Record<string, unknown>;
};

export type QQAdapter = {
  start(ctx: unknown): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: QQTarget, message: { text: string }): Promise<void>;
};

export function createAdapter(options?: { config?: Record<string, string | number | boolean> }): QQAdapter;
export function createQQAdapter(options: QQAdapterOptions): QQAdapter;
export function normalizeQQEvent(event: unknown, options?: { botId?: string }): unknown;
export function redactQQSecret(value: string): string;
