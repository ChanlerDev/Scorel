import { describe, expect, it } from "vitest";
import { hasPendingSearchNavigationTarget } from "../../src/renderer/message-navigation";

describe("hasPendingSearchNavigationTarget", () => {
  it("returns true when a new target has not been handled yet", () => {
    expect(
      hasPendingSearchNavigationTarget({ sessionId: "s1", messageId: "m1", nonce: 1 }, null),
    ).toBe(true);
  });

  it("returns false after the same target nonce was handled", () => {
    expect(
      hasPendingSearchNavigationTarget({ sessionId: "s1", messageId: "m1", nonce: 2 }, 2),
    ).toBe(false);
  });

  it("returns false when there is no active target", () => {
    expect(hasPendingSearchNavigationTarget(null, null)).toBe(false);
  });
});
