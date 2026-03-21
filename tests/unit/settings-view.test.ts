import { describe, expect, it } from "vitest";
import * as SettingsViewModule from "../../src/renderer/components/SettingsView.js";

describe("SettingsView", () => {
  it("uses the clearer unsaved-change message before testing an existing provider", () => {
    const maybeMessageFactory = (
      SettingsViewModule as Record<string, unknown>
    ).getUnsavedProviderTestMessage;

    const message = typeof maybeMessageFactory === "function"
      ? (maybeMessageFactory as () => string)()
      : null;

    expect(message).toBe("Save your changes before testing, or enter a new API key to test with.");
  });
});
