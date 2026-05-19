import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  TextContent,
  Tool
} from "./llm.js";

export type ScorelInternalMessage = {
  role: "scorel_internal";
  kind: string;
  data: unknown;
  timestamp: number;
};

export type ScorelMessage = Message | ScorelInternalMessage;

export type ScorelToolResult<TDetails = unknown> = {
  content: Array<TextContent | ImageContent>;
  details?: TDetails;
  isError?: boolean;
};

export type ScorelToolExecutionContext = {
  toolCallId: string;
  args: Record<string, unknown>;
  signal: AbortSignal;
  update?: (partial: ScorelToolResult) => void | Promise<void>;
};

export type ScorelTool = Tool & {
  label: string;
  executionMode?: "parallel" | "sequential";
  execute: (ctx: ScorelToolExecutionContext) => Promise<ScorelToolResult> | ScorelToolResult;
};

export type ScorelRuntimeStatus = "idle" | "running" | "error";

export type ScorelRuntimeState = {
  status: ScorelRuntimeStatus;
  sessionId: string;
  messages: ScorelMessage[];
  lastError?: string;
};

export type ScorelEvent =
  | { type: "runtime_start"; sessionId: string }
  | { type: "runtime_end"; sessionId: string; error?: string }
  | { type: "turn_start"; sessionId: string }
  | { type: "turn_end"; sessionId: string; usage?: AssistantMessage["usage"]; stopReason?: AssistantMessage["stopReason"] }
  | { type: "message_start"; sessionId: string; message: ScorelMessage }
  | { type: "message_update"; sessionId: string; message: ScorelMessage; delta?: string; source: AssistantMessageEvent["type"] }
  | { type: "message_end"; sessionId: string; message: ScorelMessage }
  | { type: "tool_execution_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; sessionId: string; toolCallId: string; partial: ScorelToolResult }
  | { type: "tool_execution_end"; sessionId: string; toolCallId: string; toolName: string; result: ScorelToolResult };

export type ScorelEventListener = (event: ScorelEvent) => void | Promise<void>;

export type ScorelStreamSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
) => AsyncIterable<AssistantMessageEvent> & { result(): Promise<AssistantMessage> };

export type ScorelRuntimeOptions = {
  model: Model<Api>;
  sessionId?: string;
  systemPrompt?: string;
  tools?: ScorelTool[];
  streamSimple?: ScorelStreamSimple;
  streamOptions?: SimpleStreamOptions;
  hooks?: ScorelRuntimeHooks;
};

export type ScorelRuntimeHooks = {
  buildContext?: (ctx: { messages: ScorelMessage[]; context: Context }) => Context | Promise<Context>;
  convertToLlm?: (messages: ScorelMessage[]) => Message[] | Promise<Message[]>;
  beforeToolCall?: (ctx: {
    tool: ScorelTool;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => void | { args?: Record<string, unknown> } | Promise<void | { args?: Record<string, unknown> }>;
  afterToolCall?: (ctx: {
    tool: ScorelTool;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: ScorelToolResult;
  }) => ScorelToolResult | void | Promise<ScorelToolResult | void>;
  prepareNextTurn?: (ctx: { turnIndex: number; messages: ScorelMessage[] }) => ScorelMessage[] | void | Promise<ScorelMessage[] | void>;
  shouldStopAfterTurn?: (ctx: { turnIndex: number; messages: ScorelMessage[] }) => boolean | Promise<boolean>;
};
