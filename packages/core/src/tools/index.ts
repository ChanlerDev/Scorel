import { Type, type TSchema } from "@earendil-works/pi-ai";

import type { ContentBlock, EventId } from "@scorel/protocol";

export type ToolResult = {
  content: ContentBlock[];
  details?: unknown;
};

export type AgentTool = {
  name: string;
  description: string;
  parameters: TSchema;
  hasActiveWork?: () => boolean;
  execute: (
    toolCallId: string,
    args: unknown,
    signal: AbortSignal,
    onUpdate: (partial: unknown) => void,
  ) => Promise<ToolResult>;
};

export const defineTool = (tool: AgentTool): AgentTool => tool;

export type SnipToolInput = {
  userMessageId: string;
  reason?: string;
};

export type SnipToolResult = {
  anchorUserEventId: EventId;
  throughEventId: EventId;
  hiddenEventCount: number;
};

export const createSnipTool = (options: {
  snip(input: SnipToolInput): Promise<SnipToolResult>;
}): AgentTool =>
  defineTool({
    name: "snip",
    description: [
      "Hide a completed user turn from future model context.",
      "Use only when an earlier user turn is obsolete or noisy.",
      "The session JSONL evidence is preserved; the hidden turn disappears from the next context build.",
      "Input: { userMessageId: string, reason?: string }.",
    ].join(" "),
    parameters: Type.Object({
      userMessageId: Type.String(),
      reason: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const input = parseSnipToolInput(args);
      const result = await options.snip(input);
      return {
        content: [{
          type: "text",
          text: "Snipped the selected user turn. It will be omitted from future model context.",
        }],
        details: result,
      };
    },
  });

export * from "./coding-tools.js";

const parseSnipToolInput = (args: unknown): SnipToolInput => {
  if (!isRecord(args) || typeof args.userMessageId !== "string") {
    throw new Error("snip requires { userMessageId: string }");
  }
  return {
    userMessageId: args.userMessageId as EventId,
    ...(typeof args.reason === "string" && args.reason.trim() ? { reason: args.reason.trim() } : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
