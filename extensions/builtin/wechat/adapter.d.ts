export type WeChatAdapterOptions = {
  webhookUrl: string;
};

export type WeChatTarget = {
  externalConversationId: string;
  data?: Record<string, unknown>;
};

export type WeChatAdapter = {
  start(ctx: unknown): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: WeChatTarget, message: { text: string }): Promise<void>;
};

export function createAdapter(options?: { config?: Record<string, string | number | boolean> }): WeChatAdapter;
export function createWeChatAdapter(options: WeChatAdapterOptions): WeChatAdapter;
export function normalizeWeChatEvent(event: unknown): unknown;
export function redactWeChatSecret(value: string): string;
