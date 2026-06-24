export type MessageRole = "system" | "user" | "assistant" | "tool_result";

export type TextContentBlock = {
  type: "text";
  text: string;
  visibility?: "display" | "model";
};

export type ThinkingContentBlock = {
  type: "thinking";
  text: string;
};

export type ToolCallContentBlock = {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ToolResultContentBlock = {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
};

export type SystemReminderKind =
  | "attachment"
  | "time"
  | "message_ref"
  | "skill_listing"
  | "skill_delta"
  | "memory"
  | "channel_context"
  | "steer"
  | "todo_nudge"
  | "runtime_notice"
  | "compact_summary";

export type SystemReminderOrigin = "system" | "user" | "tool" | "skill";

export type SystemReminderVisibility = "model" | "display" | "compact";

export type SystemReminderScope = "message" | "turn" | "next_model_call" | "session";

export type SystemReminderContentBlock = {
  type: "system_reminder";
  kind: SystemReminderKind;
  origin: SystemReminderOrigin;
  text: string;
  visibility: SystemReminderVisibility;
  scope: SystemReminderScope;
  data?: Record<string, unknown>;
};

export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolCallContentBlock
  | ToolResultContentBlock
  | SystemReminderContentBlock;

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type StopReason = "end_turn" | "tool_call" | "cancelled" | "max_tokens" | "error" | "unknown";

export type ScorelMessage = {
  role: MessageRole;
  content: ContentBlock[];
  usage?: Usage;
  stopReason?: StopReason;
  meta?: Record<string, unknown>;
};
