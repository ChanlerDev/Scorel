import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_COMPACT_DEFAULT_THRESHOLD } from "../../src/shared/constants.js";
import { getAutoCompactConfig, getModelContextLimit } from "../../src/main/core/auto-compact.js";
import type { SessionMeta } from "../../src/shared/types.js";

function makeSession(settings: Record<string, unknown> | null): SessionMeta {
  return {
    id: "session-1",
    title: null,
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    workspaceRoot: "/tmp/workspace",
    activeProviderId: null,
    activeModelId: null,
    activeCompactId: null,
    pinnedSystemPrompt: null,
    settings,
    parentSessionId: null,
    permissionConfig: null,
  };
}

describe("auto compact config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the default threshold when persisted threshold is invalid", () => {
    expect(getAutoCompactConfig(makeSession({ autoCompact: { enabled: true, threshold: "0.9" } }))).toEqual({
      enabled: true,
      threshold: AUTO_COMPACT_DEFAULT_THRESHOLD,
    });
  });

  it("warns when falling back to the default model context limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getModelContextLimit("unknown-model-id")).toBe(128_000);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown-model-id"),
    );
  });
});
