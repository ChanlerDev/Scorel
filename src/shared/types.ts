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
  details?: unknown;
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

export type EmbeddingConfig = {
  enabled: boolean;
  providerId: string | null;
  model: string;
  dimensions: number;
};

export type EmbeddingStatus = {
  state: "idle" | "indexing" | "reindexing";
  pendingJobs: number;
  activeJobs: number;
  indexedCount: number;
  totalCount: number | null;
  lastError: string | null;
};

// --- Tools ---

export type BuiltInToolName =
  | "bash"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "load_skill"
  | "subagent"
  | "todo_write";

export type ToolName = BuiltInToolName | string;

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

export type McpStdioTransportConfig = {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpHttpTransportConfig = {
  type: "streamable-http";
  url: string;
  headers?: Record<string, string>;
};

export type McpTransportConfig = McpStdioTransportConfig | McpHttpTransportConfig;

export type McpCapabilities = Record<string, unknown>;

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpCallToolContent =
  | { type: "text"; text: string; _meta?: Record<string, unknown> }
  | { type: "image"; data: string; mimeType: string; _meta?: Record<string, unknown> }
  | { type: "audio"; data: string; mimeType: string; _meta?: Record<string, unknown> }
  | {
      type: "resource";
      resource: {
        uri: string;
        text?: string;
        blob?: string;
        mimeType?: string;
        _meta?: Record<string, unknown>;
      };
      _meta?: Record<string, unknown>;
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
      _meta?: Record<string, unknown>;
    };

export type McpCallToolResult = {
  content: McpCallToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type McpServerConfig = {
  id: string;
  name: string;
  transport: McpTransportConfig;
  autoStart: boolean;
  enabled: boolean;
  capabilities?: McpCapabilities | null;
  createdAt: number;
  updatedAt: number;
};

export type McpServerStatus = "disconnected" | "connecting" | "initializing" | "ready" | "error";

export type McpServerSummary = McpServerConfig & {
  status: McpServerStatus;
  toolCount: number;
  lastError: string | null;
};

export type SubagentStatus = "completed" | "max_turns" | "aborted" | "error";

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

export type SessionState =
  | "idle"
  | "streaming"
  | "awaiting_approval"
  | "tooling"
  | "compacting"
  | "error";

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

export type SessionMeta = SessionSummary & {
  activeCompactId: string | null;
  pinnedSystemPrompt: string | null;
  settings: Record<string, unknown> | null;
  parentSessionId: string | null;
  permissionConfig: PermissionConfig | null;
};

export type SessionDetail = SessionMeta & {
  messages: ScorelMessage[];
};

export type StoredSessionMessage = {
  seq: number;
  message: ScorelMessage;
};

export type SearchResult = {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: ScorelMessage["role"];
  snippet: string;
  snippetSource: "fts" | "semantic";
  signals: Array<"keyword" | "semantic">;
  similarityScore?: number;
  rrfScore: number;
  ts: number;
  seq: number;
};

export type WorkspaceRecord = {
  path: string;
  label: string | null;
  lastUsedAt: number;
  createdAt: number;
};

export type WorkspaceEntry = WorkspaceRecord & {
  exists: boolean;
};

// --- Todos ---

export type TodoStatus = "pending" | "in_progress" | "done";

export type TodoItem = {
  id: string;
  sessionId: string;
  title: string;
  status: TodoStatus;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

// --- Permissions ---

export type PermissionLevel = "allow" | "confirm" | "deny";

export type PermissionConfig = {
  fullAccess: boolean;
  toolDefaults: Record<string, PermissionLevel>;
  denyReasons: Record<string, string>;
};

// --- Auto Compact ---

export type AutoCompactConfig = {
  enabled: boolean;
  threshold: number;
};
