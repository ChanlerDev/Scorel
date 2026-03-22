import { describe, expect, it, vi } from "vitest";
import * as AppModule from "../../src/renderer/App.js";

describe("App workspace helpers", () => {
  it("creates new chats in the default workspace", async () => {
    const maybeHelper = (AppModule as Record<string, unknown>).createSessionInDefaultWorkspace;
    const createSessionInDefaultWorkspace = typeof maybeHelper === "function"
      ? maybeHelper as (
        scorel: {
          app: { getDefaultWorkspace: () => Promise<string> };
          sessions: { create: (opts: { providerId: string; modelId: string; workspaceRoot: string }) => Promise<{ sessionId: string }> };
        },
        providerId: string,
        modelId: string,
      ) => Promise<{ sessionId: string; workspaceRoot: string }>
      : null;

    const scorel = {
      app: { getDefaultWorkspace: vi.fn().mockResolvedValue("/tmp/default-workspace") },
      sessions: { create: vi.fn().mockResolvedValue({ sessionId: "session-1" }) },
    };

    const result = createSessionInDefaultWorkspace
      ? await createSessionInDefaultWorkspace(scorel, "provider-1", "model-1")
      : null;

    expect(scorel.app.getDefaultWorkspace).toHaveBeenCalledTimes(1);
    expect(scorel.sessions.create).toHaveBeenCalledWith({
      providerId: "provider-1",
      modelId: "model-1",
      workspaceRoot: "/tmp/default-workspace",
    });
    expect(result).toEqual({
      sessionId: "session-1",
      workspaceRoot: "/tmp/default-workspace",
    });
  });

  it("updates the current session workspace", async () => {
    const maybeHelper = (AppModule as Record<string, unknown>).switchSessionWorkspace;
    const switchSessionWorkspace = typeof maybeHelper === "function"
      ? maybeHelper as (
        scorel: { sessions: { updateWorkspace: (sessionId: string, workspaceRoot: string) => Promise<void> } },
        sessionId: string,
        workspaceRoot: string,
      ) => Promise<void>
      : null;

    const scorel = {
      sessions: { updateWorkspace: vi.fn().mockResolvedValue(undefined) },
    };

    if (switchSessionWorkspace) {
      await switchSessionWorkspace(scorel, "session-1", "/tmp/alt-workspace");
    }

    expect(scorel.sessions.updateWorkspace).toHaveBeenCalledWith("session-1", "/tmp/alt-workspace");
  });
});
