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

  it("uses a clear permissions load failure message", () => {
    const maybeMessageFactory = (
      SettingsViewModule as Record<string, unknown>
    ).getPermissionsLoadFailureMessage;

    const message = typeof maybeMessageFactory === "function"
      ? (maybeMessageFactory as () => string)()
      : null;

    expect(message).toBe("Failed to load permissions. Changes are disabled to avoid overwriting existing settings.");
  });

  it("disables permission saving when the initial permissions load failed", () => {
    const maybePredicate = (
      SettingsViewModule as Record<string, unknown>
    ).canSavePermissions;

    const canSave = typeof maybePredicate === "function"
      ? (maybePredicate as (saving: boolean, loadError: string | null) => boolean)
      : null;

    expect(canSave?.(false, null)).toBe(true);
    expect(canSave?.(true, null)).toBe(false);
    expect(canSave?.(false, "load failed")).toBe(false);
  });
});
