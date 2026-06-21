import { Type } from "@mariozechner/pi-ai";

import { defineTool, type AgentTool } from "../tools/index.js";

export type SendChannelMessageInput = {
  text?: string;
  attachments?: SendChannelMessageAttachment[];
  channel?: string;
  target?: "current";
};

export type SendChannelMessageAttachment = {
  type: "image" | "file";
  path?: string;
  url?: string;
  mimeType?: string;
  caption?: string;
};

export type CreateSendChannelMessageToolOptions = {
  sendCurrent: (input: SendChannelMessageInput) => Promise<{ channel: string; target: string; attachments?: number }>;
};

export const createSendChannelMessageTool = (options: CreateSendChannelMessageToolOptions): AgentTool =>
  defineTool({
    name: "SendChannelMessage",
    description: "Send a text reply to the current IM channel conversation. Do not provide raw platform user ids or group ids.",
    parameters: Type.Object({
      text: Type.Optional(Type.String()),
      attachments: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([Type.Literal("image"), Type.Literal("file")]),
        path: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
        mimeType: Type.Optional(Type.String()),
        caption: Type.Optional(Type.String()),
      }))),
      channel: Type.Optional(Type.String()),
      target: Type.Optional(Type.Literal("current")),
    }),
    execute: async (_toolCallId, args) => {
      const input = parseSendChannelMessageInput(args);
      const result = await options.sendCurrent(input);
      return {
        content: [{ type: "text", text: `Channel message sent to ${result.channel}:${result.target}` }],
        details: { ...result, attachments: result.attachments ?? input.attachments?.length ?? 0 },
      };
    },
  });

const parseSendChannelMessageInput = (value: unknown): SendChannelMessageInput => {
  if (!isRecord(value)) {
    throw new Error("SendChannelMessage args must be an object");
  }
  const text = typeof value.text === "string" && value.text.trim().length > 0 ? value.text : undefined;
  const attachments = parseAttachments(value.attachments);
  if (!text && attachments.length === 0) {
    throw new Error("SendChannelMessage requires text or attachments");
  }
  if (value.channel !== undefined && (typeof value.channel !== "string" || value.channel.trim().length === 0)) {
    throw new Error("SendChannelMessage.channel must be a non-empty string when provided");
  }
  if (value.target !== undefined && value.target !== "current") {
    throw new Error("SendChannelMessage.target must be current when provided");
  }
  return {
    ...(text ? { text } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(typeof value.channel === "string" ? { channel: value.channel } : {}),
    ...(value.target === "current" ? { target: "current" as const } : {}),
  };
};

const parseAttachments = (value: unknown): SendChannelMessageAttachment[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("SendChannelMessage.attachments must be an array");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`SendChannelMessage.attachments.${index} must be an object`);
    }
    if (item.type !== "image" && item.type !== "file") {
      throw new Error(`SendChannelMessage.attachments.${index}.type must be image or file`);
    }
    const path = optionalString(item.path, `SendChannelMessage.attachments.${index}.path`);
    const url = optionalString(item.url, `SendChannelMessage.attachments.${index}.url`);
    if (!path && !url) {
      throw new Error(`SendChannelMessage.attachments.${index} requires path or url`);
    }
    return {
      type: item.type,
      ...(path ? { path } : {}),
      ...(url ? { url } : {}),
      ...(optionalString(item.mimeType, `SendChannelMessage.attachments.${index}.mimeType`) ? { mimeType: optionalString(item.mimeType, `SendChannelMessage.attachments.${index}.mimeType`) } : {}),
      ...(optionalString(item.caption, `SendChannelMessage.attachments.${index}.caption`) ? { caption: optionalString(item.caption, `SendChannelMessage.attachments.${index}.caption`) } : {}),
    };
  });
};

const optionalString = (value: unknown, name: string): string | undefined => {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
