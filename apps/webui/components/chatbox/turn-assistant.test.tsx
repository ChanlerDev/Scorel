import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
    expect(screen.getByTestId("streaming-cursor")).toBeTruthy();
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
});
