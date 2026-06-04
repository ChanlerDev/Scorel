import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScorelRuntime, type RuntimeProvider, type RuntimeProviderTurn } from "@scorel/core";
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

  it("can acknowledge an idle send after the daemon accepts the user message", async () => {
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
      options: { ack: "accepted" },
    });

    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "send_message",
      data: { status: "accepted", userEventId: expect.any(String), assistantEventId: expect.any(String) },
    });
    const eventsBeforeRelease = (await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string });
    expect(eventsBeforeRelease.some((event) => event.type === "user_message")).toBe(true);
    expect(eventsBeforeRelease.some((event) => event.type === "assistant_message")).toBe(false);

    release.resolve();
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
      options: { ack: "accepted", runningBehavior: "steer" },
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
