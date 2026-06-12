// @vitest-environment jsdom

import type { ProjectId } from "@scorel/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { App } from "./App.js";

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
});

function installScorelApi(overrides: { listSessions: ReturnType<typeof vi.fn> }): void {
  Object.defineProperty(window, "scorel", {
    configurable: true,
    value: {
      getHostStatus: vi.fn(async () => ({ state: "running" })),
      getSnapshot: vi.fn(async () => ({ projects, relayDevices: [] })),
      listSessions: overrides.listSessions,
      getExtensionSettings: vi.fn(async () => ({
        extensionId: "telegram",
        enabled: false,
        kind: "im",
        config: {},
        active: false,
      })),
      listModels: vi.fn(async () => ({ providers: [], providerModels: [], models: [], roles: { primary: "", standard: "", auxiliary: "" } })),
      getMemorySettings: vi.fn(async () => ({
        enabled: true,
        daily: true,
        sessionMemory: true,
        autoDream: true,
        promoteRoot: true,
        dreamIdleMinutes: 60,
        autoCompactThreshold: 0.8,
      })),
      onSessionEvent: vi.fn(() => () => undefined),
      onOpenSettings: vi.fn(() => () => undefined),
      detachSession: vi.fn(async () => undefined),
    },
  });
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
