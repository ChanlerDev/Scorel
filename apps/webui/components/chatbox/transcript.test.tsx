import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Transcript } from "./transcript";
import type { Turn } from "../../lib/events/projector";

afterEach(() => cleanup());

function userTurn(id: string, text: string, pending = false): Turn {
  return {
    id,
    kind: "user",
    parts: [{ kind: "text", text }],
    ...(pending ? { pending: true } : {}),
  };
}

function assistantTurn(id: string, text: string, streaming = false): Turn {
  return {
    id,
    kind: "assistant",
    parts: [{ kind: "text", text }],
    streaming,
  };
}

describe("Transcript", () => {
  it("renders an empty placeholder when no turns", () => {
    render(<Transcript turns={[]} />);
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
  });

  it("renders user and assistant turns in order", () => {
    const turns: Turn[] = [userTurn("u1", "hello"), assistantTurn("a1", "hi there")];
    render(<Transcript turns={turns} />);
    const transcript = screen.getByTestId("transcript");
    const articles = transcript.querySelectorAll("article");
    expect(articles).toHaveLength(2);
    expect(articles[0]?.getAttribute("data-testid")).toBe("turn-user");
    expect(articles[1]?.getAttribute("data-testid")).toBe("turn-assistant");
    expect(transcript.textContent).toContain("hello");
    expect(transcript.textContent).toContain("hi there");
  });

  it("flags pending user turns", () => {
    render(<Transcript turns={[userTurn("u1", "wait", true)]} />);
    const turn = screen.getByTestId("turn-user");
    expect(turn.dataset.pending).toBe("true");
    expect(turn.textContent).toContain("sending");
  });

  it("renders a tool turn for standalone tool results", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        kind: "tool",
        parts: [
          {
            kind: "tool_result",
            toolCallId: "tc1",
            toolName: "ls",
            result: "file1\nfile2",
          },
        ],
      },
    ];
    render(<Transcript turns={turns} />);
    expect(screen.getByTestId("turn-tool-standalone")).toBeTruthy();
  });
});
