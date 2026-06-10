import { defineTool, type AgentTool } from "../tools/index.js";

export type SendChannelMessageInput = {
  text: string;
  channel?: string;
  target?: "current";
};

export type CreateSendChannelMessageToolOptions = {
  sendCurrent: (input: { text: string; channel?: string; target?: "current" }) => Promise<{ channel: string; target: string }>;
};

export const createSendChannelMessageTool = (options: CreateSendChannelMessageToolOptions): AgentTool =>
  defineTool({
    name: "SendChannelMessage",
    description: "Send a text reply to the current IM channel conversation. Do not provide raw platform user ids or group ids.",
    execute: async (_toolCallId, args) => {
      const input = parseSendChannelMessageInput(args);
      const result = await options.sendCurrent(input);
      return {
        content: [{ type: "text", text: `Channel message sent to ${result.channel}:${result.target}` }],
        details: result,
      };
    },
  });

const parseSendChannelMessageInput = (value: unknown): SendChannelMessageInput => {
  if (!isRecord(value)) {
    throw new Error("SendChannelMessage args must be an object");
  }
  if (typeof value.text !== "string" || value.text.trim().length === 0) {
    throw new Error("SendChannelMessage.text must be a non-empty string");
  }
  if (value.channel !== undefined && (typeof value.channel !== "string" || value.channel.trim().length === 0)) {
    throw new Error("SendChannelMessage.channel must be a non-empty string when provided");
  }
  if (value.target !== undefined && value.target !== "current") {
    throw new Error("SendChannelMessage.target must be current when provided");
  }
  return {
    text: value.text,
    ...(typeof value.channel === "string" ? { channel: value.channel } : {}),
    ...(value.target === "current" ? { target: "current" as const } : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
