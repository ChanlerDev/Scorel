// Scorel event types — normalized provider stream + application events

import type {
  AssistantMessage,
  ToolCall,
  ToolCallPart,
  ToolResult,
  StopReason,
  UserMessage,
} from "./types.js";

// --- Normalized Provider Event Stream ---

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | {
      type: "text_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      type: "text_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
    }
  | {
      type: "thinking_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      type: "thinking_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
    }
  | {
      type: "toolcall_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      type: "toolcall_end";
      contentIndex: number;
      toolCall: ToolCallPart;
      partial: AssistantMessage;
    }
  | { type: "done"; reason: StopReason; message: AssistantMessage }
  | {
      type: "error";
      reason: "aborted" | "error";
      error: AssistantMessage;
    };

// --- Application Events ---

export type ScorelEvent =
  | { type: "session.start"; sessionId: string; ts: number; meta?: Record<string, unknown> }
  | { type: "user.prompt"; sessionId: string; ts: number; message: UserMessage }
  | {
      type: "llm.request";
      sessionId: string;
      ts: number;
      providerId: string;
      modelId: string;
      api: string;
    }
  | { type: "llm.stream"; sessionId: string; ts: number; event: AssistantMessageEvent }
  | { type: "llm.done"; sessionId: string; ts: number; message: AssistantMessage }
  | { type: "tool.exec.start"; sessionId: string; ts: number; toolCall: ToolCall }
  | {
      type: "tool.exec.update";
      sessionId: string;
      ts: number;
      toolCallId: string;
      partial: string;
    }
  | { type: "tool.exec.end"; sessionId: string; ts: number; result: ToolResult }
  | {
      type: "compact.manual";
      sessionId: string;
      ts: number;
      summaryMessageId: string;
      transcriptPath?: string;
    }
  | { type: "compact.failed"; sessionId: string; ts: number; error: string }
  | { type: "validation_warning"; sessionId: string; ts: number; detail: string }
  | { type: "runner_crash"; sessionId: string; ts: number; error: string }
  | { type: "approval.requested"; sessionId: string; ts: number; toolCall: ToolCall }
  | {
      type: "approval.resolved";
      sessionId: string;
      ts: number;
      toolCallId: string;
      decision: "approved" | "denied";
    }
  | { type: "provider.retry"; sessionId: string; ts: number; attempt: number; error: string }
  | { type: "session.abort"; sessionId: string; ts: number };
