import { describe, expect, it } from "vitest";
import type { ScorelEvent } from "../../src/shared/events.js";
import * as ChatViewModule from "../../src/renderer/components/ChatView.js";

describe("ChatView", () => {
  it("maps compact failure events to a warning notice", () => {
    const maybeMapper = (ChatViewModule as Record<string, unknown>).getCompactEventNotice;

    const notice = typeof maybeMapper === "function"
      ? (maybeMapper as (event: ScorelEvent) => { tone: "success" | "warning"; message: string } | null)({
        type: "compact.failed",
        sessionId: "session-1",
        ts: 1,
        error: "context limit reached",
      })
      : null;

    expect(notice).toEqual({
      tone: "warning",
      message: "Auto-compact failed: context limit reached",
    });
  });
});
