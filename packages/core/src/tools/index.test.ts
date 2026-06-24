import { describe, expect, it } from "vitest";

import { asEventId } from "@scorel/protocol";

import { createSnipTool } from "./index.js";

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string =>
  result.content.find((block) => block.type === "text")?.text ?? "";

describe("snip tool", () => {
  it("keeps model-visible success output minimal while retaining structured details", async () => {
    const tool = createSnipTool({
      snip: async () => ({
        anchorUserEventId: asEventId("evt_obsolete_user"),
        throughEventId: asEventId("evt_obsolete_assistant"),
        hiddenEventCount: 2,
      }),
    });

    const result = await tool.execute(
      "call_snip",
      { userMessageId: "u_12345678", reason: "obsolete" },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toBe(
      "Snipped the selected user turn. It will be omitted from future model context.",
    );
    expect(textOf(result)).not.toContain("evt_obsolete_user");
    expect(textOf(result)).not.toContain("evt_obsolete_assistant");
    expect(textOf(result)).not.toContain("2 event");
    expect(result.details).toEqual({
      anchorUserEventId: "evt_obsolete_user",
      throughEventId: "evt_obsolete_assistant",
      hiddenEventCount: 2,
    });
  });
});
