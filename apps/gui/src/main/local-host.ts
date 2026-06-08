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
import { asClientId, asDeviceId, type HostProject } from "@scorel/protocol";

type RuntimeFactory = ScorelHostOptions["createRuntime"];

export type GuiLocalHostServiceOptions = {
  stateDir: string;
  deviceId?: string;
  deviceDisplayName?: string;
  createRuntime?: RuntimeFactory;
};

export type GuiLocalHostService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  listLocalProjects(): Promise<HostProject[]>;
  registerLocalProject(workDir: string): Promise<HostProject>;
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
  };
};
