// Runner protocol types — Core side (mirrors runner/types.ts)

import type { ToolResult } from "../../shared/types.js";

export type RunnerCommand =
  | { type: "tool.exec"; requestId: string; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { type: "abort"; toolCallId: string }
  | { type: "ping" };

export type RunnerEvent =
  | { type: "tool_execution_start"; toolCallId: string }
  | { type: "tool_execution_update"; toolCallId: string; partial: string }
  | { type: "tool_execution_end"; toolCallId: string; result: ToolResult }
  | { type: "heartbeat" };

export type ToolRunner = {
  execute(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    opts?: {
      timeoutMs?: number;
      onUpdate?: (partial: string) => void;
    },
  ): Promise<ToolResult>;
  abort(toolCallId: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
