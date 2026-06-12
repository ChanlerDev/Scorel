import { describe, expect, it } from "vitest";

import { createSendChannelMessageTool } from "./index.js";

describe("channel tools", () => {
  it("sends text to the current channel context", async () => {
    const sent: Array<{ text?: string }> = [];
    const tool = createSendChannelMessageTool({
      sendCurrent: async ({ text }) => {
        sent.push({ text });
        return { channel: "loopback", target: "current" };
      },
    });

    await expect(tool.execute("call_1", { text: "hello" }, new AbortController().signal, () => undefined)).resolves.toMatchObject({
      content: [{ type: "text", text: "Channel message sent to loopback:current" }],
    });
    expect(sent).toEqual([{ text: "hello" }]);
  });

  it("sends structured attachment metadata to the current channel context", async () => {
    const sent: unknown[] = [];
    const tool = createSendChannelMessageTool({
      sendCurrent: async (input) => {
        sent.push(input);
        return { channel: "loopback", target: "current", attachments: input.attachments?.length ?? 0 };
      },
    });

    await expect(tool.execute("call_1", {
      text: "see image",
      attachments: [{ type: "image", path: "/tmp/screen.png", mimeType: "image/png", caption: "screenshot" }],
    }, new AbortController().signal, () => undefined)).resolves.toMatchObject({
      details: {
        channel: "loopback",
        target: "current",
        attachments: 1,
      },
    });
    expect(sent).toEqual([{
      text: "see image",
      attachments: [{ type: "image", path: "/tmp/screen.png", mimeType: "image/png", caption: "screenshot" }],
    }]);
  });

  it("rejects empty channel messages and unsupported attachment types", async () => {
    const tool = createSendChannelMessageTool({
      sendCurrent: async () => ({ channel: "loopback", target: "current" }),
    });

    await expect(tool.execute("call_1", {}, new AbortController().signal, () => undefined))
      .rejects.toThrow("SendChannelMessage requires text or attachments");
    await expect(tool.execute("call_1", {
      attachments: [{ type: "video", path: "/tmp/movie.mov" }],
    }, new AbortController().signal, () => undefined)).rejects.toThrow("SendChannelMessage.attachments.0.type must be image or file");
  });

  it("surfaces missing channel context as a tool error", async () => {
    const tool = createSendChannelMessageTool({
      sendCurrent: async () => {
        throw new Error("no_channel_context");
      },
    });

    await expect(tool.execute("call_1", { text: "hello" }, new AbortController().signal, () => undefined)).rejects.toThrow("no_channel_context");
  });
});
