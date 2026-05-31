import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock lazy Shiki to keep highlighter WASM out of jsdom.
vi.mock("./shiki-code-block", () => ({
  default: ({ lang, code }: { lang: string; code: string }) => (
    <pre data-testid="shiki-mock" data-lang={lang}>
      {code}
    </pre>
  ),
}));

import { TurnAssistant } from "./turn-assistant";
import type { Turn } from "../../lib/events/projector";

afterEach(() => cleanup());

function streamingTurn(text: string): Turn & { kind: "assistant" } {
  return {
    id: "a1",
    kind: "assistant",
    parts: [{ kind: "text", text }],
    streaming: true,
  };
}

function endedTurn(text: string): Turn & { kind: "assistant" } {
  return {
    id: "a1",
    kind: "assistant",
    parts: [{ kind: "text", text }],
    streaming: false,
    stopReason: "end_turn",
  };
}

describe("TurnAssistant", () => {
  it("shows a streaming cursor while streaming=true", () => {
    render(<TurnAssistant turn={streamingTurn("Hel")} />);
    const article = screen.getByTestId("turn-assistant");
    expect(article.dataset.streaming).toBe("true");
    const cursor = screen.getByTestId("streaming-cursor");
    // S0042: cursor is now the animated <StreamingCursor /> element with the
    // .scorel-caret class so the keyframes target it.
    expect(cursor.classList.contains("scorel-caret")).toBe(true);
    expect(article.textContent).toContain("Hel");
  });

  it("hides the cursor when streaming=false", () => {
    render(<TurnAssistant turn={endedTurn("Hello")} />);
    const article = screen.getByTestId("turn-assistant");
    expect(article.dataset.streaming).toBe("false");
    expect(screen.queryByTestId("streaming-cursor")).toBeNull();
  });

  it("renders an error part appended to the turn", () => {
    const turn: Turn & { kind: "assistant" } = {
      id: "a2",
      kind: "assistant",
      parts: [
        { kind: "text", text: "partial" },
        { kind: "error", message: "boom", code: "internal_error" },
      ],
      streaming: false,
    };
    render(<TurnAssistant turn={turn} />);
    expect(screen.getByTestId("error-part").textContent).toContain("boom");
  });

  it("renders a thinking part as a default-collapsed <details>", () => {
    const turn: Turn & { kind: "assistant" } = {
      id: "a3",
      kind: "assistant",
      parts: [
        { kind: "thinking", text: "let me think about it" },
        { kind: "text", text: "Done." },
      ],
      streaming: false,
    };
    render(<TurnAssistant turn={turn} />);
    const details = screen.getByTestId("thinking-part") as HTMLDetailsElement;
    expect(details.tagName.toLowerCase()).toBe("details");
    // <details> without `open` attribute starts collapsed.
    expect(details.hasAttribute("open")).toBe(false);
    const summary = details.querySelector("summary");
    expect(summary?.textContent).toMatch(/thinking/i);
  });

  it("re-renders streaming text without unmounting on extending delta", () => {
    const { rerender } = render(<TurnAssistant turn={streamingTurn("Hel")} />);
    const articleA = screen.getByTestId("turn-assistant");
    rerender(<TurnAssistant turn={streamingTurn("Hello world")} />);
    const articleB = screen.getByTestId("turn-assistant");
    // Same DOM node persists — React reconciles the markdown subtree in
    // place rather than unmounting and rebuilding.
    expect(articleB).toBe(articleA);
    expect(articleB.textContent).toContain("Hello world");
    expect(articleB.dataset.streaming).toBe("true");
  });
});
