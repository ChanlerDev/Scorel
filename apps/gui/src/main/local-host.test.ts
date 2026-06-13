import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import WebSocket from "ws";

import { ScorelRuntime, type RuntimeProvider } from "@scorel/core";
import { ScorelHost, startScorelHostWebSocketServer } from "@scorel/daemon";
import { asDeviceId } from "@scorel/protocol";
import { describe, expect, it } from "vitest";

import { createGuiLocalHostService } from "./local-host.js";

const provider: RuntimeProvider = {
  streamTurn: async function* () {
    return {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "end_turn",
    };
  },
};

describe("GUI local Host service", () => {
  it("stores local Host Project and Session state in the shared Scorel root", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-shared-state-"));
    const scorelHomeDir = join(root, ".scorel");
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const service = createGuiLocalHostService({
      stateDir: join(scorelHomeDir, "gui"),
      scorelHomeDir,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const sessionId = await service.createLocalSession(project.projectId);

      await expect(stat(join(scorelHomeDir, "projects.json"))).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(stat(join(scorelHomeDir, "sessions", `${sessionId}.jsonl`))).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(stat(join(scorelHomeDir, "gui", "projects.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(scorelHomeDir, "gui", "sessions"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await service.stop();
    }
  });

  it("attaches to an already-running singleton daemon instead of starting a GUI-local Host", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-attach-daemon-"));
    const scorelHomeDir = join(root, ".scorel");
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const host = new ScorelHost({
      sessionsDir: join(scorelHomeDir, "sessions"),
      projectsPath: join(scorelHomeDir, "projects.json"),
      deviceId: asDeviceId("device_singleton_test"),
      deviceDisplayName: "Singleton Test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });
    await host.start();
    const server = await startScorelHostWebSocketServer({
      hostService: host,
      host: "127.0.0.1",
      port: 0,
      token: "singleton-token",
    });
    const service = createGuiLocalHostService({
      stateDir: join(scorelHomeDir, "gui"),
      scorelHomeDir,
      deviceId: "device_gui_test",
      readDaemonState: async () => ({
        host: server.host,
        port: server.port,
        wsUrl: server.url,
        token: "singleton-token",
        pid: process.pid,
        startedAt: 1,
        stoppedAt: null,
      }),
      createWebSocket: (url) => new WebSocket(url),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);

      await expect(service.listLocalProjects()).resolves.toEqual([project]);
      await expect(stat(join(scorelHomeDir, "projects.json"))).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(stat(join(scorelHomeDir, "gui", "projects.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await service.stop();
      await server.close();
      await host.shutdown();
    }
  });

  it("starts the singleton daemon when daemon state is missing, then attaches to it", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-start-daemon-"));
    const scorelHomeDir = join(root, ".scorel");
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const host = new ScorelHost({
      sessionsDir: join(scorelHomeDir, "sessions"),
      projectsPath: join(scorelHomeDir, "projects.json"),
      deviceId: asDeviceId("device_singleton_start_test"),
      deviceDisplayName: "Singleton Start Test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });
    await host.start();
    const server = await startScorelHostWebSocketServer({
      hostService: host,
      host: "127.0.0.1",
      port: 0,
      token: "singleton-token",
    });
    let ensureCalls = 0;
    let readCalls = 0;
    const service = createGuiLocalHostService({
      stateDir: join(scorelHomeDir, "gui"),
      scorelHomeDir,
      deviceId: "device_gui_test",
      readDaemonState: async () => {
        readCalls += 1;
        if (readCalls === 1) return null;
        return {
          host: server.host,
          port: server.port,
          wsUrl: server.url,
          token: "singleton-token",
          pid: process.pid,
          startedAt: 1,
          stoppedAt: null,
        };
      },
      ensureDaemon: async () => {
        ensureCalls += 1;
      },
      createWebSocket: (url) => new WebSocket(url),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);

      expect(ensureCalls).toBe(1);
      await expect(service.listLocalProjects()).resolves.toEqual([project]);
      await expect(stat(join(scorelHomeDir, "gui", "projects.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await service.stop();
      await server.close();
      await host.shutdown();
    }
  });

  it("starts an embedded Host and lists registered local Projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-host-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);

      await expect(service.listLocalProjects()).resolves.toEqual([project]);
    } finally {
      await service.stop();
    }
  });

  it("creates local Project sessions and returns persisted chat events", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-workspace-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const sessionId = await service.createLocalSession(project.projectId);

      await expect(service.listLocalSessions(project.projectId)).resolves.toMatchObject([
        { sessionId, projectId: project.projectId },
      ]);

      const ack = await service.sendLocalMessage(sessionId, "hello gui");
      expect(ack).toEqual({ accepted: true });

      const events = await service.openLocalSession(sessionId);
      expect(events.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "hello gui")).toBe(true);
      expect(events.some((event) => event.type === "assistant_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "ok")).toBe(true);
    } finally {
      await service.stop();
    }
  });

  it("notifies when local session lists change", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-session-change-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const changes: Array<{ projectId: string; sessionId: string }> = [];
      const unsubscribe = service.onLocalSessionsChanged((change) => {
        changes.push(change);
      });
      const sessionId = await service.createLocalSession(project.projectId);

      expect(changes).toEqual([{ projectId: project.projectId, sessionId }]);
      unsubscribe();
    } finally {
      await service.stop();
    }
  });

  it("keeps local transcript events scoped to the opened Session", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-workspace-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const first = await service.createLocalSession(project.projectId);
      const second = await service.createLocalSession(project.projectId);

      await service.sendLocalMessage(first, "first prompt");
      await service.sendLocalMessage(second, "second prompt");

      const secondEvents = await service.openLocalSession(second);
      expect(secondEvents.every((event) => event.sessionId === second)).toBe(true);
      expect(secondEvents.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "second prompt")).toBe(true);
      expect(secondEvents.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "first prompt")).toBe(false);
    } finally {
      await service.stop();
    }
  });

  it("attaches a session and pushes events to a subscriber", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-workspace-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const sessionId = await service.createLocalSession(project.projectId);
      const seen: string[] = [];
      const { events: backlog, unsubscribe } = await service.attachLocalSession(sessionId, (event) => {
        seen.push(event.type);
      });
      expect(backlog.every((event) => event.sessionId === sessionId)).toBe(true);

      await service.sendLocalMessage(sessionId, "hello gui");
      // Wait a tick for async runtime events to settle.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(seen).toContain("user_message");
      expect(seen).toContain("assistant_message");
      unsubscribe();
    } finally {
      await service.stop();
    }
  });

  it("updates local IM extension settings through the embedded Host", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-extension-"));
    const scorelHomeDir = join(root, ".scorel");
    const service = createGuiLocalHostService({
      stateDir: join(root, "gui"),
      scorelHomeDir,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      await expect(service.getLocalExtensionSettings("telegram")).resolves.toMatchObject({
        extensionId: "telegram",
        enabled: false,
        active: false,
      });

      const next = await service.upsertLocalExtensionSettings({
        extensionId: "telegram",
        enabled: true,
        kind: "im",
        config: {
          credentialMode: "direct",
          apiKey: "123:direct_token",
          apiBaseUrl: "http://127.0.0.1:1",
          pollIntervalMs: 1000,
        },
      });

      expect(next).toMatchObject({
        extensionId: "telegram",
        enabled: true,
        active: true,
      });
      const config = await readFile(join(scorelHomeDir, "config.toml"), "utf8");
      expect(config).toContain("[extensions.telegram]");
      expect(config).toContain("[extensions.telegram.config]");
      expect(config).toContain('credentialMode = "direct"');
      expect(config).toContain('apiKey = "123:direct_token"');
      expect(config).toContain('apiBaseUrl = "http://127.0.0.1:1"');
      expect(config).not.toContain("botTokenEnv");
    } finally {
      await service.stop();
    }
  });

  it("updates local model and runtime settings in the device config", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-device-config-"));
    const scorelHomeDir = join(root, ".scorel");
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const service = createGuiLocalHostService({
      stateDir: join(root, "gui"),
      scorelHomeDir,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      await service.registerLocalProject(repo);
      await service.upsertLocalModelProfile({
        providerId: "chanleramp",
        providerType: "custom",
        provider: "chanleramp",
        api: "openai-completions",
        baseUrl: "https://amp.chanler.dev/v1/",
        apiKeyEnv: "SCOREL_API_KEY",
        modelId: "main",
        providerModelId: "deepseek-v4-flash",
        displayName: "DeepSeek Flash",
      });
      await service.upsertLocalRuntimeSettings({ tokenSavingRtk: false });

      const deviceConfig = await readFile(join(scorelHomeDir, "config.toml"), "utf8");
      expect(deviceConfig).toContain("[providers.chanleramp]");
      expect(deviceConfig).toContain("[runtime]");
      await expect(readFile(join(repo, ".scorel", "config.toml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await service.stop();
    }
  });
});
