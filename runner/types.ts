// Runner protocol types — shared between runner process and Core

export type ToolResult = {
  toolCallId: string;
  isError: boolean;
  content: string;
  details?: {
    rawOutput?: string;
    exitCode?: number;
    truncated?: boolean;
    paths?: string[];
    diff?: string;
  };
};

// Core → Runner (stdin JSONL)
export type RunnerCommand =
  | { type: "tool.exec"; requestId: string; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { type: "abort"; toolCallId: string }
  | { type: "ping" };

// Runner → Core (stdout JSONL)
export type RunnerEvent =
  | { type: "tool_execution_start"; toolCallId: string }
  | { type: "tool_execution_update"; toolCallId: string; partial: string }
  | { type: "tool_execution_end"; toolCallId: string; result: ToolResult }
  | { type: "heartbeat" };

// Tool handler signature
export type ToolHandler = (
  args: Record<string, unknown>,
  workspaceRoot: string,
  signal: AbortSignal,
) => Promise<ToolResult>;
