import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  Tool
} from "./llm.js";

export type ScorelInternalMessage = {
  role: "scorel_internal";
  kind: string;
  data: unknown;
  timestamp: number;
};

export type ScorelMessage = Message | ScorelInternalMessage;

export type ScorelTool = Tool & {
  execute?: (args: unknown, signal: AbortSignal) => Promise<unknown> | unknown;
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
  | { type: "message_end"; sessionId: string; message: ScorelMessage };

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
};
