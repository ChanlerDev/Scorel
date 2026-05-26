import type { ContentBlock } from "@scorel/protocol";

export type ToolResult = {
  content: ContentBlock[];
  details?: unknown;
};

export type AgentTool = {
  name: string;
  description: string;
  execute: (
    toolCallId: string,
    args: unknown,
    signal: AbortSignal,
    onUpdate: (partial: unknown) => void,
  ) => Promise<ToolResult>;
};

export const defineTool = (tool: AgentTool): AgentTool => tool;
