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

  it("uses runtime-equivalent defaults when a tool has no stored permission override", () => {
    const maybeResolver = (
      SettingsViewModule as Record<string, unknown>
    ).getDisplayedPermissionLevel;

    const getDisplayedPermissionLevel = typeof maybeResolver === "function"
      ? maybeResolver as (toolName: string, storedLevel?: string) => string
      : null;

    expect(getDisplayedPermissionLevel?.("read_file")).toBe("allow");
    expect(getDisplayedPermissionLevel?.("todo_write")).toBe("allow");
    expect(getDisplayedPermissionLevel?.("bash")).toBe("confirm");
    expect(getDisplayedPermissionLevel?.("read_file", "deny")).toBe("deny");
  });

  it("formats embedding status for idle and reindexing states", () => {
    const maybeFormatter = (
      SettingsViewModule as Record<string, unknown>
    ).formatEmbeddingStatus;

    const formatEmbeddingStatus = typeof maybeFormatter === "function"
      ? maybeFormatter as (
        status: {
          state: "idle" | "indexing" | "reindexing";
          pendingJobs: number;
          activeJobs: number;
          indexedCount: number;
          totalCount: number | null;
          lastError: string | null;
        },
        activeCount: number,
      ) => string
      : null;

    expect(formatEmbeddingStatus?.({
      state: "idle",
      pendingJobs: 0,
      activeJobs: 0,
      indexedCount: 0,
      totalCount: null,
      lastError: null,
    }, 12)).toBe("12 active embedding chunks");

    expect(formatEmbeddingStatus?.({
      state: "reindexing",
      pendingJobs: 4,
      activeJobs: 1,
      indexedCount: 3,
      totalCount: 10,
      lastError: null,
    }, 12)).toBe("Re-indexing 3/10 sources");
  });
});
