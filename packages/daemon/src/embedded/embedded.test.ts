import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScorelRuntime, loadScorelConfig, loadScorelConfigProfile, type RuntimeProvider, type RuntimeProviderTurn, type ScorelConfig } from "@scorel/core";
import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSessionId,
  type DaemonMessage,
  type HostProject,
  type ScorelMessage,
} from "@scorel/protocol";

import { ScorelHost, createEmbeddedTransport } from "../index.js";

const assistantMessage = (text: string): ScorelMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

const provider: RuntimeProvider = {
  streamTurn: async function* () {
    return assistantMessage("ok");
  },
};

const modelProfile: ScorelConfig = {
  providers: {
    test: {
      type: "custom",
      api: "openai-completions",
      provider: "scorel-test",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "secret",
    },
  },
  providerModels: {
    main: {
      provider: "test",
      id: "main-model",
      displayName: "Main Model",
      contextWindow: 400000,
      maxTokens: 128000,
      reasoning: true,
    },
    aux: {
      provider: "test",
      id: "aux-model",
      displayName: "Aux Model",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: false,
    },
  },
  models: {
    main: { model: "main", displayName: "Main Model" },
    aux: { model: "aux", displayName: "Aux Model" },
  },
  modelProfile: {
    roles: {
      primary: "main",
      standard: "main",
      auxiliary: "aux",
    },
  },
  memory: {
    enabled: true,
    daily: true,
    sessionMemory: true,
    autoDream: true,
    promoteRoot: true,
    dreamIdleMinutes: 60,
    autoCompactThreshold: 0.8,
  },
  extensions: {},
};

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-host-"));
  const sessionsDir = join(root, "sessions");
  const projectsPath = join(root, "projects.json");
  await mkdir(sessionsDir);
  const runtimeProjects: HostProject[] = [];
  const host = new ScorelHost({
    sessionsDir,
    projectsPath,
    deviceId: asDeviceId("device_test"),
    createRuntime: async ({ project }) => {
      runtimeProjects.push(project);
      return new ScorelRuntime({ provider });
    },
    now: () => 1_000,
  });
  await host.start();
  return { root, sessionsDir, projectsPath, runtimeProjects, host };
};

const fixtureWithModelProfile = async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-host-models-"));
  const sessionsDir = join(root, "sessions");
  const projectsPath = join(root, "projects.json");
  await mkdir(sessionsDir);
  const runtimeSelections: string[] = [];
  const host = new ScorelHost({
    sessionsDir,
    projectsPath,
    deviceId: asDeviceId("device_test"),
    modelProfile,
    memoryHomeDir: root,
    createRuntime: async ({ selectedModel }) => {
      runtimeSelections.push(selectedModel?.modelId ?? "none");
      return new ScorelRuntime({ provider });
    },
    now: () => 1_000,
  });
  await host.start();
  return { root, sessionsDir, projectsPath, runtimeSelections, host };
};

describe("ScorelHost + embedded transport", () => {
  it("treats concurrent explicit create_session requests as the same session", async () => {
    const { root, host } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const sessionId = asSessionId("ses_create_race");
    const transportA = createEmbeddedTransport(host);
    const transportB = createEmbeddedTransport(host);
    await transportA.connect({ clientId: asClientId("client_a"), sessionId });
    await transportB.connect({ clientId: asClientId("client_b"), sessionId });
    const responseA = waitForResponse(transportA, "req_a");
    const responseB = waitForResponse(transportB, "req_b");

    await Promise.all([
      transportA.send({
        type: "create_session",
        requestId: asRequestId("req_a"),
        sessionId,
        meta: { projectId: project.projectId },
      }),
      transportB.send({
        type: "create_session",
        requestId: asRequestId("req_b"),
        sessionId,
        meta: { projectId: project.projectId },
      }),
    ]);

    await expect(responseA).resolves.toMatchObject({ type: "response", requestType: "create_session" });
    await expect(responseB).resolves.toMatchObject({ type: "response", requestType: "create_session" });
  });

  it("isolates runtime work directories for sessions in two registered projects", async () => {
    const { root, runtimeProjects, host } = await fixture();
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    await Promise.all([mkdir(repoA), mkdir(repoB)]);
    const projectA = await host.registerProject(repoA);
    const projectB = await host.registerProject(repoB);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });

    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_a"),
      sessionId: asSessionId("ses_a"),
      meta: { projectId: projectA.projectId },
    });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_b"),
      sessionId: asSessionId("ses_b"),
      meta: { projectId: projectB.projectId },
    });

    expect(runtimeProjects.map((project) => project.workDir).sort()).toEqual(
      (await Promise.all([realpath(repoA), realpath(repoB)])).sort(),
    );
    expect((await host.listProjects()).map((project) => project.projectId).sort()).toEqual(
      [projectA.projectId, projectB.projectId].sort(),
    );
  });

  it("lists configured models without provider credentials", async () => {
    const { root, host } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models"),
      projectId: project.projectId,
    });

    const resolved = await response;
    expect(resolved).toMatchObject({
      type: "response",
      requestType: "list_models",
      data: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "aux",
        },
        models: [
          {
            modelId: "main",
            providerId: "test",
            provider: "scorel-test",
            id: "main-model",
            displayName: "Main Model",
            roles: ["primary", "standard"],
          },
          {
            modelId: "aux",
            providerId: "test",
            provider: "scorel-test",
            id: "aux-model",
            displayName: "Aux Model",
            roles: ["auxiliary"],
          },
        ],
      },
    });
    if (resolved.type !== "response") throw new Error("expected response");
    expect(JSON.stringify(resolved.data)).not.toContain("secret");
  });

  it("injects memory context and lets the agent append daily notes through AppendDaily", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-memory-tool-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    const journalProvider: RuntimeProvider = {
      streamTurn: async function* ({ context, tools }) {
        const hasDailyToolResult = context.some((message) =>
          message.role === "tool_result" &&
          message.content.some((block) => block.type === "tool_result" && block.toolName === "AppendDaily"),
        );
        if (tools.some((tool) => tool.name === "AppendDaily") && !hasDailyToolResult) {
          return {
            role: "assistant",
            content: [{
              type: "tool_call",
              toolCallId: "call_daily",
              toolName: "AppendDaily",
              args: {
                summary: "记住这个项目的 memory 设计方向",
                completed: ["验证 memory harness 注入"],
                decisions: ["daily 由 AppendDaily 工具写入"],
              },
            }],
            stopReason: "tool_call",
          };
        }
        return assistantMessage("ok");
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile,
      memoryHomeDir: root,
      createRuntime: async () => new ScorelRuntime({ provider: journalProvider }),
      now: () => 1_000,
    });
    await host.start();
    const repo = join(root, "repo-memory");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_memory") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_memory_create"),
      sessionId: asSessionId("ses_memory"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_memory_send");

    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_memory_send"),
      sessionId: asSessionId("ses_memory"),
      content: "记住这个项目的 memory 设计方向",
    });

    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });
    const daily = await readFile(
      join(root, ".scorel", "memory", "projects", project.projectId, "daily", "1970-01-01.md"),
      "utf8",
    );
    expect(daily).toContain("记住这个项目的 memory 设计方向");

    const sessionFile = await readFile(join(root, "sessions", "ses_memory.jsonl"), "utf8");
    expect(sessionFile).toContain('"type":"harness_item"');
    expect(sessionFile).toContain('"kind":"memory"');
    expect(sessionFile).toContain('"toolName":"AppendDaily"');
  });

  it("injects memory context only once for a session even across days", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-memory-once-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    let now = Date.UTC(2026, 5, 11, 8);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile,
      memoryHomeDir: root,
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => now,
    });
    await host.start();
    const repo = join(root, "repo-memory-once");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_memory_once") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_memory_once_create"),
      sessionId: asSessionId("ses_memory_once"),
      meta: { projectId: project.projectId },
    });

    const firstResponse = waitForResponse(transport, "req_memory_once_first");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_memory_once_first"),
      sessionId: asSessionId("ses_memory_once"),
      content: "第一天",
    });
    await expect(firstResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    now = Date.UTC(2026, 5, 12, 8);
    const secondResponse = waitForResponse(transport, "req_memory_once_second");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_memory_once_second"),
      sessionId: asSessionId("ses_memory_once"),
      content: "第二天继续同一个 session",
    });
    await expect(secondResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const sessionFile = await readFile(join(root, "sessions", "ses_memory_once.jsonl"), "utf8");
    const memoryHarnesses = sessionFile
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; item?: { kind?: string } })
      .filter((event) => event.type === "harness_item" && event.item?.kind === "memory");
    expect(memoryHarnesses).toHaveLength(1);
  });

  it("maintains session memory asynchronously after completed turns", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-session-memory-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    const sessionMemoryProvider: RuntimeProvider = {
      streamTurn: async function* () {
        return assistantMessage(JSON.stringify({
          summary: "正在实现 S0086 auto compact",
          recentMessages: ["用户要求 session memory 作为异步 auto compact"],
          decisions: ["session memory 不写入长期 MEMORY"],
          followUps: ["达到阈值时直接用 session memory 写 compact"],
        }));
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile,
      memoryHomeDir: root,
      createRuntime: async ({ purpose }) => new ScorelRuntime({ provider: purpose === "memory" ? sessionMemoryProvider : provider }),
      now: () => Date.UTC(2026, 5, 11, 9, 0),
    });
    await host.start();
    const repo = join(root, "repo-session-memory");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_session_memory") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_session_memory_create"),
      sessionId: asSessionId("ses_session_memory"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_session_memory_send");

    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_session_memory_send"),
      sessionId: asSessionId("ses_session_memory"),
      content: "实现 S0086",
    });

    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });
    const sessionMemoryPath = join(root, ".scorel", "context", "session-memory", project.projectId, "ses_session_memory.md");
    await waitUntil(async () => {
      const content = await readFile(sessionMemoryPath, "utf8").catch(() => "");
      return content.includes("正在实现 S0086 auto compact");
    });
    const content = await readFile(sessionMemoryPath, "utf8");
    expect(content).toContain("session memory 不写入长期 MEMORY");
  });

  it("auto compacts from existing session memory at the threshold", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-auto-compact-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    const compactProfile: ScorelConfig = {
      ...modelProfile,
      providerModels: {
        ...modelProfile.providerModels,
        main: {
          ...modelProfile.providerModels.main,
          contextWindow: 1000,
        },
      },
      memory: {
        ...modelProfile.memory,
        autoCompactThreshold: 0.1,
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile: compactProfile,
      memoryHomeDir: root,
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => Date.UTC(2026, 5, 11, 9, 0),
    });
    await host.start();
    const repo = join(root, "repo-auto-compact");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    await mkdir(join(root, ".scorel", "context", "session-memory", project.projectId), { recursive: true });
    await writeFile(
      join(root, ".scorel", "context", "session-memory", project.projectId, "ses_compact.md"),
      "# Session Memory: ses_compact\n\n## Current State\nReady compact summary from background session memory.\n",
      "utf8",
    );
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_compact") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_compact_create"),
      sessionId: asSessionId("ses_compact"),
      meta: { projectId: project.projectId },
    });

    const firstResponse = waitForResponse(transport, "req_compact_first");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_compact_first"),
      sessionId: asSessionId("ses_compact"),
      content: "x".repeat(900),
    });
    await expect(firstResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const secondResponse = waitForResponse(transport, "req_compact_second");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_compact_second"),
      sessionId: asSessionId("ses_compact"),
      content: "continue",
    });
    await expect(secondResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const sessionFile = await readFile(join(root, "sessions", "ses_compact.jsonl"), "utf8");
    expect(sessionFile).toContain('"type":"compact"');
    expect(sessionFile).toContain("Ready compact summary from background session memory");
    expect(sessionFile.indexOf('"type":"compact"')).toBeLessThan(sessionFile.lastIndexOf('"type":"user_message"'));
  });

  it("falls back to foreground compact when session memory is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-foreground-compact-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    const compactProfile: ScorelConfig = {
      ...modelProfile,
      providerModels: {
        ...modelProfile.providerModels,
        main: {
          ...modelProfile.providerModels.main,
          contextWindow: 1000,
        },
      },
      memory: {
        ...modelProfile.memory,
        sessionMemory: false,
        autoCompactThreshold: 0.1,
      },
    };
    const compactProvider: RuntimeProvider = {
      streamTurn: async function* () {
        return assistantMessage("Foreground compact summary from auxiliary.");
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile: compactProfile,
      memoryHomeDir: root,
      createRuntime: async ({ purpose }) => new ScorelRuntime({ provider: purpose === "memory" ? compactProvider : provider }),
      now: () => Date.UTC(2026, 5, 11, 9, 0),
    });
    await host.start();
    const repo = join(root, "repo-foreground-compact");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_foreground_compact") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_foreground_compact_create"),
      sessionId: asSessionId("ses_foreground_compact"),
      meta: { projectId: project.projectId },
    });

    const firstResponse = waitForResponse(transport, "req_foreground_compact_first");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_foreground_compact_first"),
      sessionId: asSessionId("ses_foreground_compact"),
      content: "x".repeat(900),
    });
    await expect(firstResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const secondResponse = waitForResponse(transport, "req_foreground_compact_second");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_foreground_compact_second"),
      sessionId: asSessionId("ses_foreground_compact"),
      content: "continue",
    });
    await expect(secondResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const sessionFile = await readFile(join(root, "sessions", "ses_foreground_compact.jsonl"), "utf8");
    expect(sessionFile).toContain('"type":"compact"');
    expect(sessionFile).toContain("Foreground compact summary from auxiliary.");
  });

  it("does not block indefinitely when session memory update is in flight during compact", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-inflight-compact-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    const compactProfile: ScorelConfig = {
      ...modelProfile,
      providerModels: {
        ...modelProfile.providerModels,
        main: {
          ...modelProfile.providerModels.main,
          contextWindow: 1000,
        },
      },
      memory: {
        ...modelProfile.memory,
        autoCompactThreshold: 0.1,
      },
    };
    const never = new Promise<ScorelMessage>(() => undefined);
    const compactProvider: RuntimeProvider = {
      streamTurn: async function* ({ context }) {
        const prompt = context.map((message) => message.content.map((block) => block.type === "text" ? block.text : "").join("\n")).join("\n");
        if (prompt.includes("Update Scorel session memory")) {
          return await never;
        }
        return assistantMessage("Foreground compact while session memory update is still running.");
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile: compactProfile,
      memoryHomeDir: root,
      createRuntime: async ({ purpose }) => new ScorelRuntime({ provider: purpose === "memory" ? compactProvider : provider }),
      now: () => Date.UTC(2026, 5, 11, 9, 0),
    });
    await host.start();
    const repo = join(root, "repo-inflight-compact");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_inflight_compact") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_inflight_compact_create"),
      sessionId: asSessionId("ses_inflight_compact"),
      meta: { projectId: project.projectId },
    });

    const firstResponse = waitForResponse(transport, "req_inflight_compact_first");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_inflight_compact_first"),
      sessionId: asSessionId("ses_inflight_compact"),
      content: "x".repeat(900),
    });
    await expect(firstResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const secondResponse = waitForResponse(transport, "req_inflight_compact_second");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_inflight_compact_second"),
      sessionId: asSessionId("ses_inflight_compact"),
      content: "continue",
    });
    await expect(secondResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const sessionFile = await readFile(join(root, "sessions", "ses_inflight_compact.jsonl"), "utf8");
    expect(sessionFile).toContain('"type":"compact"');
    expect(sessionFile).toContain("Foreground compact while session memory update is still running.");
  }, 10_000);

  it("runs idle dream after AppendDaily and updates project/root memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-idle-dream-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    await mkdir(sessionsDir);
    const dreamProfile: ScorelConfig = {
      ...modelProfile,
      memory: {
        ...modelProfile.memory,
        dreamIdleMinutes: 0,
      },
    };
    const journalProvider: RuntimeProvider = {
      streamTurn: async function* ({ context, tools }) {
        const hasDailyToolResult = context.some((message) =>
          message.role === "tool_result" &&
          message.content.some((block) => block.type === "tool_result" && block.toolName === "AppendDaily"),
        );
        if (tools.some((tool) => tool.name === "AppendDaily") && !hasDailyToolResult) {
          return {
            role: "assistant",
            content: [{
              type: "tool_call",
              toolCallId: "call_daily",
              toolName: "AppendDaily",
              args: {
                summary: "S0082 改成 AppendDaily 加 idle dream",
                decisions: ["dreamer 只负责 project 和 root memory"],
              },
            }],
            stopReason: "tool_call",
          };
        }
        return assistantMessage("ok");
      },
    };
    const dreamProvider: RuntimeProvider = {
      streamTurn: async function* () {
        return assistantMessage(JSON.stringify({
          projectMemory: "# Project Memory\n\n- Daily is written by AppendDaily.\n",
          rootMemory: "# Memory\n\n- User prefers memory design explained through messages assembly.\n",
        }));
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile: dreamProfile,
      memoryHomeDir: root,
      createRuntime: async ({ purpose }) => new ScorelRuntime({ provider: purpose === "memory" ? dreamProvider : journalProvider }),
      now: () => 1_000,
    });
    await host.start();
    const repo = join(root, "repo-dream");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_dream") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_dream_create"),
      sessionId: asSessionId("ses_dream"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_dream_send");

    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_dream_send"),
      sessionId: asSessionId("ses_dream"),
      content: "记录日记并稍后 dream",
    });

    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });
    await waitUntil(async () => {
      const memory = await readFile(join(root, ".scorel", "memory", "projects", project.projectId, "MEMORY.md"), "utf8");
      return memory.includes("Daily is written by AppendDaily");
    });
    await waitUntil(async () => {
      const rootMemory = await readFile(join(root, ".scorel", "memory", "MEMORY.md"), "utf8");
      return rootMemory.includes("messages assembly");
    });
    const completedStatus = waitForResponse(transport, "req_dream_status_completed");
    await transport.send({
      type: "get_memory_status",
      requestId: asRequestId("req_dream_status_completed"),
      projectId: project.projectId,
    });
    await expect(completedStatus).resolves.toMatchObject({
      type: "response",
      requestType: "get_memory_status",
      data: {
        status: {
          projectId: project.projectId,
          dirty: false,
          running: false,
          lastSuccessAt: 1_000,
          lastProjectMemoryUpdateAt: 1_000,
          lastRootMemoryUpdateAt: 1_000,
        },
      },
    });
  });

  it("routes loopback IM messages through fixed session, channel reminder, skill index, and SendChannelMessage", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-im-loopback-"));
    const scorelHomeDir = join(root, ".scorel");
    const sessionsDir = join(scorelHomeDir, "sessions");
    const projectsPath = join(scorelHomeDir, "projects.json");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(scorelHomeDir, "config.toml"), [
      "[extensions.loopback]",
      "enabled = true",
      'kind = "im"',
      "",
    ].join("\n"));

    const providerTurns: RuntimeProviderTurn[] = [];
    let requestedChannelReplies = 0;
    const imProvider: RuntimeProvider = {
      streamTurn: async function* (turn) {
        providerTurns.push(turn);
        if (turn.context.at(-1)?.role === "user" && turn.tools.some((tool) => tool.name === "SendChannelMessage")) {
          requestedChannelReplies += 1;
          return {
            role: "assistant",
            content: [{
              type: "tool_call",
              toolCallId: `call_channel_reply_${requestedChannelReplies}`,
              toolName: "SendChannelMessage",
              args: { text: "loopback reply" },
            }],
            stopReason: "tool_call",
          };
        }
        return assistantMessage("done");
      },
    };
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      scorelHomeDir,
      builtinExtensionsDir: join(process.cwd(), "..", "..", "extensions", "builtin"),
      deviceId: asDeviceId("device_test"),
      modelProfile,
      createRuntime: async () => new ScorelRuntime({ provider: imProvider }),
      now: () => 1_000,
    });
    await host.start();

    const sessionId = await host.receiveImMessage("loopback", {
      externalConversationId: "dm:test-user",
      text: "hello from im",
      conversationType: "private",
      senderDisplayName: "Chanler",
      target: { externalConversationId: "dm:test-user" },
    });
    const sessionIdAgain = await host.receiveImMessage("loopback", {
      externalConversationId: "dm:test-user",
      text: "second message",
      conversationType: "private",
      target: { externalConversationId: "dm:test-user" },
    });

    expect(sessionIdAgain).toBe(sessionId);
    expect(host.loopbackOutbox()).toEqual([{ text: "loopback reply" }, { text: "loopback reply" }]);
    const workspace = await realpath(join(scorelHomeDir, "workspace"));
    expect((await host.listProjects()).some((project) => project.workDir === workspace)).toBe(true);

    const sessionFile = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf8");
    expect(sessionFile).toContain('"kind":"channel_context"');
    expect(sessionFile).toContain('"channel":"loopback"');
    expect(sessionFile).toContain('"scope":"extension"');
    expect(providerTurns[0]?.tools.map((tool) => tool.name)).toContain("SendChannelMessage");
    expect(providerTurns[0]?.context.some((message) =>
      message.meta?.source === "harness_item" &&
      message.meta.harnessKind === "channel_context"
    )).toBe(true);
  });

  it("returns an empty model profile when project config is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-empty-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_empty");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_empty"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "list_models",
      data: {
        models: [],
        roles: {
          primary: "",
          standard: "",
          auxiliary: "",
        },
      },
    });
  });

  it("surfaces development-stage legacy models config as a schema error", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-legacy-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
    await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[models.main]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"
`);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_legacy");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_legacy"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "error",
      code: "internal_error",
      message: expect.stringContaining("Unsupported config section: models.main"),
    });
  });

  it("surfaces the deprecated single model config as a schema error", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-legacy-single-model-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
    await writeFile(join(repo, ".scorel", "config.toml"), `
[model]
type = "builtin"
provider = "openai"
id = "gpt-5.4-mini"
apiKeyEnv = "SCOREL_API_KEY"
`);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_legacy_single");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_legacy_single"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "error",
      code: "internal_error",
      message: expect.stringContaining("Unsupported config section: model"),
    });
  });

  it("surfaces invalid model profile config instead of treating it as empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-invalid-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
    await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "openai_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "missing"
auxiliary = "main"
`);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_invalid");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_invalid"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "error",
      requestId: "req_models_invalid",
      message: "model_profile.roles.standard must reference a configured model",
    });
  });

  it("writes GUI model profile changes without requiring provider credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-upsert-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) =>
        loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) =>
        loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_upsert_models");

    await transport.send({
      type: "upsert_model_profile",
      requestId: asRequestId("req_upsert_models"),
      projectId: project.projectId,
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

    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "upsert_model_profile",
      data: {
        providers: [
          {
            providerId: "chanleramp",
            provider: "chanleramp",
            apiKeyEnv: "SCOREL_API_KEY",
            credentialSource: "env",
            credentialStatus: "missing",
          },
        ],
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "main",
        },
        models: [
          {
            modelId: "main",
            providerId: "chanleramp",
            provider: "chanleramp",
            id: "deepseek-v4-flash",
            displayName: "DeepSeek Flash",
            roles: ["primary", "standard", "auxiliary"],
          },
        ],
      },
    });
    const config = await readFile(join(repo, ".scorel", "config.toml"), "utf8");
    expect(config).toContain("[providers.chanleramp]");
    expect(config).toContain("[provider_models.chanleramp_main]");
    expect(config).toContain("[available_models.main]");
    expect(config).toContain('apiKeyEnv = "SCOREL_API_KEY"');
    expect(config).not.toContain("contextWindow");
    expect(config).not.toContain("maxTokens");
    expect(config).not.toContain("reasoning");
    expect(config).not.toContain("secret");

    const secondResponse = waitForResponse(transport, "req_upsert_aux_model");
    await transport.send({
      type: "upsert_model_profile",
      requestId: asRequestId("req_upsert_aux_model"),
      projectId: project.projectId,
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      modelId: "aux",
      providerModelId: "deepseek-v4-lite",
      displayName: "DeepSeek Lite",
      roles: {
        primary: "main",
        standard: "main",
        auxiliary: "aux",
      },
    });

    await expect(secondResponse).resolves.toMatchObject({
      type: "response",
      requestType: "upsert_model_profile",
      data: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "aux",
        },
        models: [
          { modelId: "aux" },
          { modelId: "main" },
        ],
      },
    });
    const mergedConfig = await readFile(join(repo, ".scorel", "config.toml"), "utf8");
    expect(mergedConfig).toContain("[provider_models.chanleramp_main]");
    expect(mergedConfig).toContain("[provider_models.chanleramp_aux]");
    expect(mergedConfig).toContain("[available_models.main]");
    expect(mergedConfig).toContain("[available_models.aux]");

    const removeResponse = waitForResponse(transport, "req_remove_aux_model");
    await transport.send({
      type: "upsert_model_profile",
      requestId: asRequestId("req_remove_aux_model"),
      projectId: project.projectId,
      providerId: "chanleramp",
      providerModelKey: "chanleramp_aux",
      providerModelId: "deepseek-v4-lite",
      displayName: "DeepSeek Lite",
      removeAvailableModelId: "aux",
    });

    await expect(removeResponse).resolves.toMatchObject({
      type: "response",
      requestType: "upsert_model_profile",
      data: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "main",
        },
        models: [
          { modelId: "main" },
        ],
      },
    });
    const removedConfig = await readFile(join(repo, ".scorel", "config.toml"), "utf8");
    expect(removedConfig).toContain("[provider_models.chanleramp_aux]");
    expect(removedConfig).not.toContain("[available_models.aux]");
    expect(removedConfig).toContain('auxiliary = "main"');
  });

  it("fetches provider catalog models through a real /models endpoint", async () => {
    const server = createServer((request, response) => {
      if (request.url !== "/v1/models") {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== "Bearer secret") {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-lite", name: "DeepSeek Lite" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected local server address");
    try {
      const root = await mkdtemp(join(tmpdir(), "scorel-host-provider-catalog-"));
      const sessionsDir = join(root, "sessions");
      const projectsPath = join(root, "projects.json");
      const repo = join(root, "repo");
      await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
      await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.chanleramp]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
baseUrl = "http://127.0.0.1:${address.port}/v1"
apiKey = "secret"
`);
      const host = new ScorelHost({
        sessionsDir,
        projectsPath,
        deviceId: asDeviceId("device_test"),
        loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: process.env }),
        loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: process.env }),
        createRuntime: async () => new ScorelRuntime({ provider }),
        now: () => 1_000,
      });
      await host.start();
      const project = await host.registerProject(repo);
      const transport = createEmbeddedTransport(host);
      await transport.connect({ clientId: asClientId("client_test") });
      const response = waitForResponse(transport, "req_fetch_provider_models");

      await transport.send({
        type: "fetch_provider_models",
        requestId: asRequestId("req_fetch_provider_models"),
        projectId: project.projectId,
        providerId: "chanleramp",
      });

      await expect(response).resolves.toMatchObject({
        type: "response",
        requestType: "fetch_provider_models",
        data: {
          models: [
            { id: "deepseek-v4-flash", displayName: "deepseek-v4-flash" },
            { id: "deepseek-v4-lite", displayName: "DeepSeek Lite" },
          ],
        },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("persists the default standard model selection in new session headers", async () => {
    const { root, sessionsDir, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });

    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_model_default"),
      meta: { projectId: project.projectId },
    });

    const header = JSON.parse((await readFile(join(sessionsDir, "ses_model_default.jsonl"), "utf8")).split("\n")[0]!);
    expect(header.meta.selectedModel).toMatchObject({
      modelId: "main",
      role: "standard",
      displayName: "Main Model",
    });
    expect(runtimeSelections).toEqual(["main"]);
  });

  it("persists explicit model selection and reuses it when restoring a session", async () => {
    const { root, sessionsDir, projectsPath, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_seed") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_model_restore"),
      meta: { projectId: project.projectId, modelSelection: { modelId: "aux" } },
    });
    await host.shutdown();

    const restoredSelections: string[] = [];
    const restored = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile,
      memoryHomeDir: root,
      createRuntime: async ({ selectedModel }) => {
        restoredSelections.push(selectedModel?.modelId ?? "none");
        return new ScorelRuntime({ provider });
      },
    });
    await restored.start();
    const restoredTransport = createEmbeddedTransport(restored);
    await restoredTransport.connect({ clientId: asClientId("client_restored") });
    await restoredTransport.send({
      type: "load_session",
      requestId: asRequestId("req_load"),
      sessionId: asSessionId("ses_model_restore"),
    });

    const header = JSON.parse((await readFile(join(sessionsDir, "ses_model_restore.jsonl"), "utf8")).split("\n")[0]!);
    expect(header.meta.selectedModel).toMatchObject({
      modelId: "aux",
      displayName: "Aux Model",
    });
    expect(runtimeSelections).toEqual(["aux"]);
    expect(restoredSelections).toEqual(["aux"]);
  });

  it("generates a first-message session title with the auxiliary model", async () => {
    const { root, sessionsDir, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_title"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_send_title");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send_title"),
      sessionId: asSessionId("ses_title"),
      content: "Help me configure provider models.",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    let events: { type: string; title?: string; source?: string; model?: { modelId?: string } }[] = [];
    await waitUntil(async () => {
      const lines = (await readFile(join(sessionsDir, "ses_title.jsonl"), "utf8")).trim().split("\n");
      events = lines.slice(1).map((line) => JSON.parse(line) as { type: string; title?: string; source?: string; model?: { modelId?: string } });
      return events.some((event) => event.type === "session_title_updated");
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "session_title_updated",
      title: "ok",
      source: "model",
      model: expect.objectContaining({ modelId: "aux" }),
    }));
    expect(runtimeSelections.slice(0, 2)).toEqual(["main", "aux"]);

    const listResponse = waitForResponse(transport, "req_list_title");
    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_title"),
      projectId: project.projectId,
    });
    await expect(listResponse).resolves.toMatchObject({
      type: "response",
      requestType: "list_sessions",
      data: {
        sessions: [
          expect.objectContaining({
            sessionId: "ses_title",
            title: "ok",
          }),
        ],
      },
    });
  });

  it("does not generate a model title when the session already has an explicit title", async () => {
    const { root, sessionsDir, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_explicit_title"),
      meta: { projectId: project.projectId, title: "Manual title" },
    });
    const response = waitForResponse(transport, "req_send_explicit_title");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send_explicit_title"),
      sessionId: asSessionId("ses_explicit_title"),
      content: "hello",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const file = await readFile(join(sessionsDir, "ses_explicit_title.jsonl"), "utf8");
    expect(file).not.toContain("session_title_updated");
    expect(runtimeSelections[0]).toBe("main");
  });

  it("persists project ownership in session headers and restores lanes through the registry", async () => {
    const { root, sessionsDir, projectsPath, host } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_seed") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_restart"),
      meta: { projectId: project.projectId },
    });
    await host.shutdown();

    const restoredProjects: HostProject[] = [];
    const restored = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async ({ project: restoredProject }) => {
        restoredProjects.push(restoredProject);
        return new ScorelRuntime({ provider });
      },
    });
    await restored.start();
    const restoredTransport = createEmbeddedTransport(restored);
    await restoredTransport.connect({ clientId: asClientId("client_restored") });
    await restoredTransport.send({
      type: "load_session",
      requestId: asRequestId("req_load"),
      sessionId: asSessionId("ses_restart"),
    });

    expect(restoredProjects).toEqual([project]);
    const header = JSON.parse((await readFile(join(sessionsDir, "ses_restart.jsonl"), "utf8")).split("\n")[0]!);
    expect(header.meta).toEqual({ projectId: project.projectId });
  });

  it("writes an instruction snapshot before the first user message and passes it as systemPrompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-instructions-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(sessionsDir);
    await writeFile(join(repo, "AGENTS.md"), "Always say repo-rule.");
    const providerTurns: RuntimeProviderTurn[] = [];
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* (turn) {
              providerTurns.push(turn);
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_instruction"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_send");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_instruction"),
      content: "hello",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const lines = (await readFile(join(sessionsDir, "ses_instruction.jsonl"), "utf8")).trim().split("\n");
    const events = lines.slice(1).map((line) => JSON.parse(line) as { type: string; snapshot?: unknown });
    expect(events.map((event) => event.type).slice(0, 4)).toEqual([
      "instruction_snapshot",
      "skill_index_snapshot",
      "harness_item",
      "user_message",
    ]);
    expect(providerTurns[0]?.systemPrompt).toContain("Always say repo-rule.");
    expect(providerTurns[0]?.systemPrompt).toContain("Workspace cwd:");
  });

  it("queues send_message as follow-up while a turn is running and consumes it after the final leaf", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-follow-up-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const releases = [deferred<void>(), deferred<void>()];
    let providerCall = 0;
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* () {
              const release = releases[providerCall++]!;
              await release.promise;
              return assistantMessage(`ok ${providerCall}`);
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_follow"),
      meta: { projectId: project.projectId },
    });
    const firstResponse = waitForResponse(transport, "req_first");
    const secondResponse = waitForResponse(transport, "req_second");
    void transport.send({
      type: "send_message",
      requestId: asRequestId("req_first"),
      sessionId: asSessionId("ses_follow"),
      content: "first",
    });
    await eventually(() => expect(providerCall).toBe(1));
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_second"),
      sessionId: asSessionId("ses_follow"),
      content: "second",
    });

    releases[0]!.resolve();
    await expect(firstResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });
    await eventually(() => expect(providerCall).toBe(2));
    releases[1]!.resolve();
    await expect(secondResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const events = (await readFile(join(sessionsDir, "ses_follow.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; message?: { meta?: Record<string, unknown> }; parentId?: string; id?: string });
    const followUpUser = events.find((event) => event.type === "user_message" && event.message?.meta?.source === "follow_up");
    const firstAssistant = events.find((event) => event.type === "assistant_message");
    expect(events.some((event) => event.type === "queue_update")).toBe(true);
    expect(followUpUser?.parentId).toBe(firstAssistant?.id);
    expect(followUpUser?.message?.meta?.queueItemId).toEqual(expect.any(String));
  });

  it("broadcasts a durable user_message before completing an idle send request", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-accepted-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const release = deferred<void>();
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* () {
              await release.promise;
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_accepted"),
      meta: { projectId: project.projectId },
    });

    const response = waitForResponse(transport, "req_send");
    void transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_accepted"),
      content: "first",
    });

    let eventsBeforeRelease: Array<{ type: string }> = [];
    for (let i = 0; i < 50; i += 1) {
      eventsBeforeRelease = (await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string });
      if (eventsBeforeRelease.some((event) => event.type === "user_message")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(eventsBeforeRelease.some((event) => event.type === "user_message")).toBe(true);
    expect(eventsBeforeRelease.some((event) => event.type === "assistant_message")).toBe(false);

    release.resolve();
    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "send_message",
      data: { status: "completed", userEventId: expect.any(String), assistantEventId: expect.any(String) },
    });
    for (let i = 0; i < 50; i += 1) {
      const text = await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8");
      if (text.includes("\"assistant_message\"")) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8")).toContain("\"assistant_message\"");
  });

  it("queues a running steer request separately from follow-up", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-steer-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const release = deferred<void>();
    let providerCall = 0;
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* () {
              providerCall += 1;
              await release.promise;
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_steer"),
      meta: { projectId: project.projectId },
    });
    void transport.send({
      type: "send_message",
      requestId: asRequestId("req_first"),
      sessionId: asSessionId("ses_steer"),
      content: "first",
    });
    await eventually(() => expect(providerCall).toBe(1));

    const steerResponse = waitForResponse(transport, "req_steer");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_steer"),
      sessionId: asSessionId("ses_steer"),
      content: "guide current run",
      options: { runningBehavior: "steer" },
    });

    await expect(steerResponse).resolves.toMatchObject({
      type: "response",
      requestType: "send_message",
      data: { status: "queued", queue: "steer", queueItemId: expect.any(String) },
    });
    const events = (await readFile(join(sessionsDir, "ses_steer.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; queue?: string; items?: unknown[] });
    const queueEvent = events.find((event) => event.type === "queue_update" && event.queue === "steer");
    expect(queueEvent?.items).toHaveLength(1);
    expect(events.some((event) => event.type === "queue_update" && event.queue === "follow_up")).toBe(false);

    release.resolve();
  });

  it("syncs skill index before a user turn and registers the Skill tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-skills-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await mkdir(join(repo, ".scorel", "skills", "verify"), { recursive: true });
    await mkdir(sessionsDir);
    await writeFile(join(repo, ".scorel", "skills", "verify", "SKILL.md"), "---\ndescription: verify repo\n---\nRun checks.");
    const providerTurns: RuntimeProviderTurn[] = [];
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* (turn) {
              providerTurns.push(turn);
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_skills"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_send");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_skills"),
      content: "hello",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const events = (await readFile(join(sessionsDir, "ses_skills.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; entries?: Array<{ name: string }>; item?: { kind: string } });
    expect(events.map((event) => event.type).slice(0, 4)).toEqual([
      "instruction_snapshot",
      "skill_index_snapshot",
      "harness_item",
      "user_message",
    ]);
    expect(events.find((event) => event.type === "skill_index_snapshot")?.entries?.map((entry) => entry.name)).toEqual([
      "verify",
    ]);
    expect(events.find((event) => event.type === "harness_item")?.item?.kind).toBe("skill_listing");
    expect(providerTurns[0]?.context[0]?.content[0]).toEqual({
      type: "text",
      text: "<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- verify: verify repo\n</system-reminder>",
    });
    expect(providerTurns[0]?.tools.map((tool) => tool.name)).toContain("Skill");
  });

  it("rejects creating a session for an unregistered project", async () => {
    const { host } = await fixture();
    const transport = createEmbeddedTransport(host);
    const response = waitForResponse(transport, "req_missing");
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_missing"),
      sessionId: asSessionId("ses_missing"),
      meta: { projectId: "prj_missing" as never },
    });
    await expect(response).resolves.toMatchObject({ type: "error", code: "project_not_found" });
  });
});

const waitForResponse = (transport: ReturnType<typeof createEmbeddedTransport>, requestId: string): Promise<DaemonMessage> =>
  new Promise((resolve) => {
    transport.onMessage((message) => {
      if ("requestId" in message && message.requestId === requestId) {
        resolve(message);
      }
    });
  });

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const eventually = async (assertion: () => void): Promise<void> => {
  let lastError: unknown;
  for (let i = 0; i < 50; i += 1) {
    try {
      assertion();
      return;
    } catch (cause) {
      lastError = cause;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
};

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met");
};
