import type {
  ScorelMessage,
  SystemReminderContentBlock,
  SystemReminderKind,
  SystemReminderOrigin,
  SystemReminderScope,
  SystemReminderVisibility,
  ToolResultContentBlock,
} from "@scorel/protocol";

export type CreateSystemReminderBlockInput = {
  kind: SystemReminderKind;
  origin: SystemReminderOrigin;
  text: string;
  visibility: SystemReminderVisibility;
  scope: SystemReminderScope;
  data?: Record<string, unknown>;
};

export const createSystemReminderBlock = (
  input: CreateSystemReminderBlockInput,
): SystemReminderContentBlock => ({
  type: "system_reminder",
  kind: input.kind,
  origin: input.origin,
  text: input.text,
  visibility: input.visibility,
  scope: input.scope,
  ...(input.data ? { data: { ...input.data } } : {}),
});

export const renderSystemReminderText = (text: string): string =>
  `<system-reminder>\n${text}\n</system-reminder>`;

export const renderSystemReminder = (input: SystemReminderContentBlock | string): string =>
  renderSystemReminderText(typeof input === "string" ? input : input.text);

export const systemReminderMessage = (
  block: SystemReminderContentBlock,
  meta?: Record<string, unknown>,
): ScorelMessage => ({
  role: "user",
  content: [cloneSystemReminderBlock(block)],
  ...(meta ? { meta: { ...meta } } : {}),
});

export const appendSystemReminderToToolResult = (
  message: ScorelMessage,
  block: SystemReminderContentBlock,
): boolean => {
  for (let i = message.content.length - 1; i >= 0; i -= 1) {
    const candidate = message.content[i];
    if (candidate?.type !== "tool_result" || !isToolResultWithContent(candidate.result)) {
      continue;
    }
    const mergedResult = {
      ...candidate.result,
      content: [...candidate.result.content, cloneSystemReminderBlock(block)],
    };
    message.content[i] = {
      ...candidate,
      result: mergedResult,
    } satisfies ToolResultContentBlock;
    return true;
  }
  return false;
};

export const cloneSystemReminderBlock = (
  block: SystemReminderContentBlock,
): SystemReminderContentBlock => ({
  ...block,
  ...(block.data ? { data: { ...block.data } } : {}),
});

const isToolResultWithContent = (value: unknown): value is { content: unknown[] } =>
  typeof value === "object" &&
  value !== null &&
  "content" in value &&
  Array.isArray((value as { content?: unknown }).content);
