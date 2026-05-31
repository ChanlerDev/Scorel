import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Mock the lazy Shiki block — turn-tool renders ```json fences through
// MarkdownView, which would otherwise pull the Shiki chunk into jsdom.
vi.mock("./shiki-code-block", () => ({
  default: ({ lang, code }: { lang: string; code: string }) => (
    <pre data-testid="shiki-mock" data-lang={lang}>
      {code}
    </pre>
  ),
}));

import { TurnTool } from "./turn-tool";

afterEach(() => cleanup());

describe("TurnTool", () => {
  it("tool_call defaults to collapsed and renders payload through MarkdownView when expanded", async () => {
    render(
      <TurnTool
        part={{
          kind: "tool_call",
          toolCallId: "tc_1",
          toolName: "ls",
          args: { path: ".", recursive: true },
        }}
      />,
    );
    const wrapper = screen.getByTestId("turn-tool-call");
    expect(wrapper.dataset.toolOpen).toBe("false");
    expect(screen.queryByTestId("shiki-mock")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(wrapper.dataset.toolOpen).toBe("true");

    const block = await screen.findByTestId("shiki-mock");
    expect(block.dataset.lang).toBe("json");
    expect(block.textContent).toContain('"path": "."');
    expect(block.textContent).toContain('"recursive": true');
  });

  it("successful tool_result defaults to collapsed", () => {
    render(
      <TurnTool
        part={{
          kind: "tool_result",
          toolCallId: "tc_1",
          toolName: "ls",
          result: ["a.txt", "b.txt"],
        }}
      />,
    );
    const wrapper = screen.getByTestId("turn-tool-result");
    expect(wrapper.dataset.toolOpen).toBe("false");
  });

  it("error tool_result defaults to expanded with the JSON fence rendered", async () => {
    render(
      <TurnTool
        part={{
          kind: "tool_result",
          toolCallId: "tc_1",
          toolName: "edit",
          result: { error: "no such file" },
          isError: true,
        }}
      />,
    );
    const wrapper = screen.getByTestId("turn-tool-result");
    expect(wrapper.dataset.toolOpen).toBe("true");
    const block = await screen.findByTestId("shiki-mock");
    expect(block.dataset.lang).toBe("json");
    expect(block.textContent).toContain('"error": "no such file"');
  });
});
