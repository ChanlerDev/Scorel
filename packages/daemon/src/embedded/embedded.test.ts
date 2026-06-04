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
    expect(events.map((event) => event.type).slice(0, 2)).toEqual(["instruction_snapshot", "user_message"]);
    expect(providerTurns[0]?.systemPrompt).toContain("Always say repo-rule.");
    expect(providerTurns[0]?.systemPrompt).toContain("Workspace cwd:");
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
