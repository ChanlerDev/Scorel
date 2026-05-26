export type MessageRole = "system" | "user" | "assistant" | "tool_result";

export type TextContentBlock = {
  type: "text";
  text: string;
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

export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolCallContentBlock
  | ToolResultContentBlock;

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
