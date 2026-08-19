// @vitest-environment jsdom

import type { ProjectId } from "@scorel/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { App } from "./App.js";
import type { GuiDeviceRef, GuiModelProfileView } from "../shared/ipc.js";

const projects = [
  {
    source: "local" as const,
    projectId: "project_workspace" as ProjectId,
    displayName: "workspace",
    workDir: "/tmp/workspace",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    source: "local" as const,
    projectId: "project_scorel" as ProjectId,
    displayName: "Scorel",
    workDir: "/tmp/Scorel",
    createdAt: 2,
    updatedAt: 2,
  },
  {
    source: "local" as const,
    projectId: "project_tickel" as ProjectId,
    displayName: "Tickel",
    workDir: "/tmp/Tickel",
    createdAt: 3,
    updatedAt: 3,
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = undefined;
  container?.remove();
  container = undefined;
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GUI App session preload", () => {
  it("loads sessions for the selected and expanded Projects on startup", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.setItem("scorel.gui.collapsed", JSON.stringify({
      "project:local:project_scorel": false,
    }));

    const listSessions = vi.fn(async ({ projectId }: { projectId: ProjectId }) => [
      {
        sessionId: `session_${projectId}` as never,
        projectId,
        title: `Session for ${projectId}`,
        updatedAt: 1,
        currentSeq: 1 as never,
      },
    ]);

    installScorelApi({
      listSessions,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<App />);
    });
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(listSessions).toHaveBeenCalledTimes(2);
    expect(listSessions).toHaveBeenCalledWith({ source: "local", projectId: "project_workspace" });
    expect(listSessions).toHaveBeenCalledWith({ source: "local", projectId: "project_scorel" });
    expect(listSessions).not.toHaveBeenCalledWith({ source: "local", projectId: "project_tickel" });
  });

  it("refreshes loaded Project sessions so background IM sessions become visible", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    let calls = 0;
    let sessionsChanged: ((payload: { source: "local"; projectId: string; sessionId: string }) => void) | undefined;
    const listSessions = vi.fn(async ({ projectId }: { projectId: ProjectId }) => {
      calls += 1;
      return calls < 2
        ? []
        : [{
            sessionId: "session_im_qq" as never,
            projectId,
            title: "qq: qq:private:user_1",
            updatedAt: 2,
            currentSeq: 1 as never,
          }];
    });

    installScorelApi({
      listSessions,
      onSessionsChanged: vi.fn((handler) => {
        sessionsChanged = handler;
        return () => undefined;
      }),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<App />);
    });
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    await act(async () => {
      sessionsChanged?.({ source: "local", projectId: "project_workspace", sessionId: "session_im_qq" });
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("qq: qq:private:user_1");
  });

  it("loads memory status for the selected Project", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const getMemoryStatus = vi.fn(async () => ({
      projectId: "project_workspace",
      dirty: false,
      running: false,
      lastDailyAppendAt: 1781611581901,
    }));

    installScorelApi({
      listSessions: vi.fn(async () => []),
      getMemoryStatus,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<App />);
    });

    await waitFor(() => expect(getMemoryStatus).toHaveBeenCalledWith({ source: "local", projectId: "project_workspace" }));
  });

  it("keeps remote settings data when an older local settings request resolves later", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    let openSettings: (() => void) | undefined;
    const localModels = deferred<GuiModelProfileView>();
    const remoteModels = deferred<GuiModelProfileView>();
    const listModels = vi.fn((device: GuiDeviceRef) =>
      device.source === "relay" ? remoteModels.promise : localModels.promise,
    );

    installScorelApi({
      listSessions: vi.fn(async () => []),
      listModels,
      onOpenSettings: vi.fn((handler) => {
        openSettings = handler;
        return () => undefined;
      }),
      snapshot: {
        projects,
        relayDevices: [{ deviceId: "device_remote", label: "Remote Device", relayUrl: "wss://scorel-relay.chanler.dev", online: true, updatedAt: 1 }],
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<App />);
    });
    await act(async () => {
      openSettings?.();
    });
    await waitFor(() => expect(container!.querySelector(".settings-shell")).not.toBeNull());
    const select = container!.querySelector(".settings-nav__scope select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      select!.value = "relay:device_remote";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    remoteModels.resolve(profileWithModel("remote_model", "Remote Model"));
    await waitFor(() => expect(container!.textContent).toContain("Remote Model"));

    localModels.resolve(profileWithModel("local_model", "Local Model"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Remote Model");
    expect(container!.textContent).not.toContain("Local Model");
  });
});

function installScorelApi(overrides: {
  listSessions: ReturnType<typeof vi.fn>;
  listModels?: ReturnType<typeof vi.fn>;
  getMemoryStatus?: ReturnType<typeof vi.fn>;
  onSessionsChanged?: ReturnType<typeof vi.fn>;
  onOpenSettings?: ReturnType<typeof vi.fn>;
  snapshot?: { projects: typeof projects; relayDevices: Array<{ deviceId: string; label: string; relayUrl: string; online: boolean; updatedAt: number }> };
}): void {
  Object.defineProperty(window, "scorel", {
    configurable: true,
    value: {
      getHostStatus: vi.fn(async () => ({ state: "running" })),
      getSnapshot: vi.fn(async () => overrides.snapshot ?? { projects, relayDevices: [] }),
      listSessions: overrides.listSessions,
      getExtensionSettings: vi.fn(async () => ({
        extensionId: "telegram",
        enabled: false,
        kind: "im",
        config: {},
        active: false,
      })),
      listModels: overrides.listModels ?? vi.fn(async () => ({ providers: [], providerModels: [], models: [], roles: { primary: "", standard: "", auxiliary: "" } })),
      getMemorySettings: vi.fn(async () => ({
        enabled: true,
        daily: true,
        sessionMemory: true,
        autoDream: true,
        promoteRoot: true,
        dreamIdleMinutes: 60,
        autoCompactThreshold: 0.8,
      })),
      getMemoryStatus: overrides.getMemoryStatus ?? vi.fn(async () => ({
        projectId: "project_scorel",
        dirty: false,
        running: false,
      })),
      getRuntimeSettings: vi.fn(async () => ({
        tokenSavingRtk: false,
        rtkAvailable: false,
        estimatedOutputTokens: 0,
        estimatedSavedTokens: 0,
      })),
      getTaskBudgetSettings: vi.fn(async () => ({
        maxTokens: 0,
        maxCostUsd: 0,
        maxWallClockMinutes: 0,
        repeatedCommandThreshold: 3,
        staleProgressMinutes: 10,
      })),
      getObservabilitySettings: vi.fn(async () => ({
        local: true,
        sync: { enabled: false, mode: "manual", targets: [] },
        langfuse: { enabled: false },
        otel: { enabled: false, protocol: "otlp-http" },
      })),
      onSessionEvent: vi.fn(() => () => undefined),
      onSessionsChanged: overrides.onSessionsChanged ?? vi.fn(() => () => undefined),
      onOpenSettings: overrides.onOpenSettings ?? vi.fn(() => () => undefined),
      detachSession: vi.fn(async () => undefined),
    },
  });
}

function profileWithModel(modelId: string, displayName: string): GuiModelProfileView {
  return {
    providers: [{
      providerId: `${modelId}_provider`,
      type: "custom",
      provider: "scorel-test",
      api: "openai-completions",
      baseUrl: "https://llm.example.test/v1",
      credentialSource: "direct",
      credentialStatus: "available",
    }],
    providerModels: [{
      providerModelId: `${modelId}_provider_model`,
      providerId: `${modelId}_provider`,
      provider: "scorel-test",
      id: modelId,
      displayName,
      availableModelIds: [modelId],
    }],
    models: [{
      modelId,
      providerModelId: `${modelId}_provider_model`,
      providerId: `${modelId}_provider`,
      provider: "scorel-test",
      id: modelId,
      displayName,
      roles: ["standard"],
    }],
    roles: {
      primary: modelId,
      standard: modelId,
      auxiliary: modelId,
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(assertion: () => void): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 1000) {
    try {
      assertion();
      return;
    } catch (cause) {
      lastError = cause;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}
