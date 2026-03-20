// Scorel canonical message model
// Aligned with pi-ai's Message/Context/StopReason/AssistantMessageEvent

// --- Primitives ---

export type Api = "openai-chat-completions" | "anthropic-messages";

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type TextPart = { type: "text"; text: string };

export type ToolCallPart = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ThinkingPart = {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

export type ContentPart = TextPart | ToolCallPart | ThinkingPart;

// --- Messages ---

export type UserMessage = {
  role: "user";
  id: string;
  content: string; // V0: text only
  ts: number;
  meta?: Record<string, unknown>;
};

export type AssistantMessage = {
  role: "assistant";
  id: string;
  api: Api;
  providerId: string;
  modelId: string;
  content: ContentPart[];
  stopReason: StopReason;
  errorMessage?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  ts: number;
  meta?: Record<string, unknown>;
};

export type ToolResultMessage = {
  role: "toolResult";
  id: string;
  toolCallId: string;
  toolName: string;
  isError: boolean;
  content: TextPart[];
  details?: {
    rawOutput?: string;
    exitCode?: number;
    truncated?: boolean;
    paths?: string[];
    diff?: string;
  };
  ts: number;
  meta?: Record<string, unknown>;
};

export type ScorelMessage = UserMessage | AssistantMessage | ToolResultMessage;

// --- Provider ---

export type ProviderCompat = {
  supportsDeveloperRole?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
};

export type ProviderConfig = {
  id: string;
  displayName: string;
  api: Api;
  baseUrl: string;
  auth: { type: "bearer" | "x-api-key"; keyRef: string; headerName?: string };
  defaultHeaders?: Record<string, string>;
  compat?: ProviderCompat;
  models: Array<{ id: string; displayName: string }>;
  meta?: Record<string, unknown>;
};

// --- Tools ---

export type ToolName =
  | "bash"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "load_skill";

export type ToolCall = {
  toolCallId: string;
  name: ToolName;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  toolCallId: string;
  isError: boolean;
  content: string;
  details?: unknown;
};

export type CompactionRecord = {
  id: string;
  sessionId: string;
  boundaryMessageId: string;
  summaryText: string;
  providerId: string;
  modelId: string;
  transcriptPath: string | null;
  createdAt: number;
};

export type ManualCompactResult = {
  compactionId: string;
  summaryText: string;
  boundaryMessageId: string;
  transcriptPath?: string;
};

export type SkillMeta = {
  name: string;
  description: string;
  version: string;
  filePath: string;
};

// --- Session ---

export type SessionSummary = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  workspaceRoot: string;
  activeProviderId: string | null;
  activeModelId: string | null;
};

export type SessionDetail = SessionSummary & {
  activeCompactId: string | null;
  pinnedSystemPrompt: string | null;
  settings: Record<string, unknown> | null;
  messages: ScorelMessage[];
};

export type SearchResult = {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: ScorelMessage["role"];
  snippet: string;
  ts: number;
  seq: number;
};
