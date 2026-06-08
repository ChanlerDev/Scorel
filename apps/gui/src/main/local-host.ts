import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { DaemonClient } from "@scorel/client";
import {
  createEmbeddedTransport,
  createRealRuntime,
  loadScorelConfig,
  ScorelHost,
  type ScorelHostOptions,
} from "@scorel/daemon";
import {
  asClientId,
  asDeviceId,
  asProjectId,
  asSessionId,
  type HostProject,
  type PersistentEvent,
  type ProjectId,
  type ScorelEvent,
  type SessionId,
  type SessionSummary,
} from "@scorel/protocol";

type RuntimeFactory = ScorelHostOptions["createRuntime"];

export type GuiLocalHostServiceOptions = {
  stateDir: string;
  deviceId?: string;
  deviceDisplayName?: string;
  createRuntime?: RuntimeFactory;
};

export type GuiLocalSubscriber = (event: ScorelEvent) => void;

export type GuiLocalHostService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  listLocalProjects(): Promise<HostProject[]>;
  registerLocalProject(workDir: string): Promise<HostProject>;
  listLocalSessions(projectId: string): Promise<SessionSummary[]>;
  createLocalSession(projectId: string): Promise<SessionId>;
  openLocalSession(sessionId: string): Promise<PersistentEvent[]>;
  attachLocalSession(sessionId: string, handler: GuiLocalSubscriber): Promise<{
    events: PersistentEvent[];
    unsubscribe: () => void;
  }>;
  sendLocalMessage(sessionId: string, content: string): Promise<{ accepted: true }>;
};

export const createGuiLocalHostService = (options: GuiLocalHostServiceOptions): GuiLocalHostService => {
  const sessionsDir = join(options.stateDir, "sessions");
  const projectsPath = join(options.stateDir, "projects.json");
  let started = false;
  const host = new ScorelHost({
    sessionsDir,
    projectsPath,
    deviceId: asDeviceId(options.deviceId ?? "device_gui_local"),
    deviceDisplayName: options.deviceDisplayName ?? "Local",
    createRuntime:
      options.createRuntime ??
      (async ({ project }) =>
        createRealRuntime({
          cwd: project.workDir,
          config: await loadScorelConfig({ cwd: project.workDir }),
        })),
  });
  const client = new DaemonClient(createEmbeddedTransport(host), {
    clientId: asClientId("client_gui"),
  });

  return {
    async start() {
      if (started) return;
      await mkdir(sessionsDir, { recursive: true });
      try {
        await host.start();
        await client.connect();
        started = true;
      } catch (cause) {
        client.disconnect();
        await host.shutdown();
        throw cause;
      }
    },
    async stop() {
      if (!started) return;
      client.disconnect();
      await host.shutdown();
      started = false;
    },
    listLocalProjects() {
      return client.listProjects();
    },
    registerLocalProject(workDir) {
      return client.registerProject(workDir);
    },
    listLocalSessions(projectId) {
      return client.listSessions({ projectId: asProjectId(projectId) as ProjectId });
    },
    createLocalSession(projectId) {
      return client.createSession({ meta: { projectId: asProjectId(projectId) as ProjectId } });
    },
    async openLocalSession(sessionId) {
      await client.loadSession(asSessionId(sessionId));
      return client.getEvents().filter((event) => event.sessionId === sessionId);
    },
    async attachLocalSession(sessionId, handler) {
      await client.loadSession(asSessionId(sessionId));
      const filteredHandler: GuiLocalSubscriber = (event) => {
        if (event.sessionId === sessionId) handler(event);
      };
      const unsubscribe = client.subscribe(filteredHandler);
      const events = client.getEvents().filter((event) => event.sessionId === sessionId);
      return { events, unsubscribe };
    },
    async sendLocalMessage(sessionId, content) {
      await client.loadSession(asSessionId(sessionId));
      await client.sendMessage(content);
      return { accepted: true };
    },
  };
};
