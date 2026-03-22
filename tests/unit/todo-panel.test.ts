import { describe, expect, it } from "vitest";
import * as TodoPanelModule from "../../src/renderer/components/TodoPanel.js";

describe("TodoPanel", () => {
  it("formats todo load failures consistently", () => {
    const maybeFormatter = (TodoPanelModule as Record<string, unknown>).getTodoPanelLoadFailureMessage;

    const message = typeof maybeFormatter === "function"
      ? (maybeFormatter as (error: unknown) => string)(new Error("boom"))
      : null;

    expect(message).toBe("Failed to load todos: boom");
  });

  it("does not let the initial todo load overwrite newer event data", () => {
    const maybePredicate = (TodoPanelModule as Record<string, unknown>).shouldApplyTodoLoadResult;

    const shouldApply = typeof maybePredicate === "function"
      ? (maybePredicate as (hasReceivedEvent: boolean) => boolean)
      : null;

    expect(shouldApply?.(false)).toBe(true);
    expect(shouldApply?.(true)).toBe(false);
  });
});
