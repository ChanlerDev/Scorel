import { describe, expect, it } from "vitest";

import { createSendChannelMessageTool } from "./index.js";

describe("channel tools", () => {
  it("sends text to the current channel context", async () => {
    const sent: string[] = [];
    const tool = createSendChannelMessageTool({
      sendCurrent: async ({ text }) => {
        sent.push(text);
        return { channel: "loopback", target: "current" };
      },
    });

    await expect(tool.execute("call_1", { text: "hello" }, new AbortController().signal, () => undefined)).resolves.toMatchObject({
      content: [{ type: "text", text: "Channel message sent to loopback:current" }],
    });
    expect(sent).toEqual(["hello"]);
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
