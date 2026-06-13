import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ClientId, DeviceId, HostProject, ProjectId } from "@scorel/protocol";

export type GuiRelayDevice = {
  deviceId: DeviceId;
  label: string;
  relayUrl: string;
  clientId: ClientId;
  online?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type GuiVisibleRemoteProject = {
  deviceId: DeviceId;
  projectId: ProjectId;
  displayName: string;
  workDir: string;
  relayUrl: string;
  createdAt: number;
  updatedAt: number;
};

export type GuiStoreSnapshot = {
  relayDevices: GuiRelayDevice[];
  visibleRemoteProjects: GuiVisibleRemoteProject[];
};

export type GuiStore = {
  load(): Promise<GuiStoreSnapshot>;
  listRelayDevices(): Promise<GuiRelayDevice[]>;
  upsertRelayDevice(input: Omit<GuiRelayDevice, "createdAt" | "updatedAt">): Promise<GuiRelayDevice>;
  renameRelayDevice(deviceId: DeviceId, label: string): Promise<GuiRelayDevice>;
  upsertVisibleRemoteProject(input: {
    device: GuiRelayDevice;
    project: HostProject;
  }): Promise<GuiVisibleRemoteProject>;
  hideVisibleRemoteProject(deviceId: DeviceId, projectId: ProjectId): Promise<boolean>;
};

const emptySnapshot = (): GuiStoreSnapshot => ({
  relayDevices: [],
  visibleRemoteProjects: [],
});

export const createGuiStore = (filePath: string): GuiStore => {
  const commit = async (snapshot: GuiStoreSnapshot): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  };

  const load = async (): Promise<GuiStoreSnapshot> => {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySnapshot();
      }
      throw cause;
    }
    const parsed = JSON.parse(raw) as Partial<GuiStoreSnapshot>;
    return {
      relayDevices: Array.isArray(parsed.relayDevices) ? parsed.relayDevices.map(normalizeRelayDevice) : [],
      visibleRemoteProjects: Array.isArray(parsed.visibleRemoteProjects)
        ? parsed.visibleRemoteProjects.map(normalizeVisibleRemoteProject)
        : [],
    };
  };

  return {
    load,
    async listRelayDevices() {
      return (await load()).relayDevices;
    },
    async upsertRelayDevice(input) {
      const snapshot = await load();
      const now = Date.now();
      const index = snapshot.relayDevices.findIndex((device) => device.deviceId === input.deviceId);
      const existing = index >= 0 ? snapshot.relayDevices[index] : undefined;
      const next: GuiRelayDevice = {
        ...input,
        label: existing?.label.trim() || input.label.trim() || String(input.deviceId),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const relayDevices = [...snapshot.relayDevices];
      if (index >= 0) {
        relayDevices[index] = next;
      } else {
        relayDevices.push(next);
      }
      await commit({ ...snapshot, relayDevices: sortRelayDevices(relayDevices) });
      return next;
    },
    async renameRelayDevice(deviceId, label) {
      const snapshot = await load();
      const index = snapshot.relayDevices.findIndex((device) => device.deviceId === deviceId);
      if (index < 0) {
        throw new Error(`Relay Device is not configured: ${deviceId}`);
      }
      const next: GuiRelayDevice = {
        ...snapshot.relayDevices[index]!,
        label: label.trim() || String(deviceId),
        updatedAt: Date.now(),
      };
      const relayDevices = [...snapshot.relayDevices];
      relayDevices[index] = next;
      await commit({ ...snapshot, relayDevices: sortRelayDevices(relayDevices) });
      return next;
    },
    async upsertVisibleRemoteProject(input) {
      const snapshot = await load();
      const now = Date.now();
      const index = snapshot.visibleRemoteProjects.findIndex(
        (project) => project.deviceId === input.device.deviceId && project.projectId === input.project.projectId,
      );
      const next: GuiVisibleRemoteProject = {
        deviceId: input.device.deviceId,
        projectId: input.project.projectId,
        displayName: input.project.displayName,
        workDir: input.project.workDir,
        relayUrl: input.device.relayUrl,
        createdAt: index >= 0 ? snapshot.visibleRemoteProjects[index]!.createdAt : now,
        updatedAt: now,
      };
      const visibleRemoteProjects = [...snapshot.visibleRemoteProjects];
      if (index >= 0) {
        visibleRemoteProjects[index] = next;
      } else {
        visibleRemoteProjects.push(next);
      }
      await commit({
        ...snapshot,
        visibleRemoteProjects: sortVisibleRemoteProjects(visibleRemoteProjects),
      });
      return next;
    },
    async hideVisibleRemoteProject(deviceId, projectId) {
      const snapshot = await load();
      const visibleRemoteProjects = snapshot.visibleRemoteProjects.filter(
        (project) => !(project.deviceId === deviceId && project.projectId === projectId),
      );
      if (visibleRemoteProjects.length === snapshot.visibleRemoteProjects.length) return false;
      await commit({ ...snapshot, visibleRemoteProjects });
      return true;
    },
  };
};

const normalizeRelayDevice = (input: GuiRelayDevice): GuiRelayDevice => ({
  deviceId: input.deviceId,
  label: typeof input.label === "string" && input.label.trim() ? input.label : String(input.deviceId),
  relayUrl: input.relayUrl,
  clientId: input.clientId,
  online: input.online,
  createdAt: Number(input.createdAt) || Date.now(),
  updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now(),
});

const normalizeVisibleRemoteProject = (input: GuiVisibleRemoteProject): GuiVisibleRemoteProject => ({
  deviceId: input.deviceId,
  projectId: input.projectId,
  displayName: input.displayName,
  workDir: input.workDir,
  relayUrl: input.relayUrl,
  createdAt: Number(input.createdAt) || Date.now(),
  updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now(),
});

const sortRelayDevices = (devices: GuiRelayDevice[]): GuiRelayDevice[] =>
  [...devices].sort((left, right) => left.label.localeCompare(right.label) || String(left.deviceId).localeCompare(String(right.deviceId)));

const sortVisibleRemoteProjects = (projects: GuiVisibleRemoteProject[]): GuiVisibleRemoteProject[] =>
  [...projects].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      String(left.deviceId).localeCompare(String(right.deviceId)) ||
      String(left.projectId).localeCompare(String(right.projectId)),
  );
