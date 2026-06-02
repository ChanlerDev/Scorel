// syncProjects: pulls the daemon-truth project list for a connected device
// (per S0036) and writes it into the DevicesStore. The session list per
// project is not fetched here — that lives in `./sessions.ts` and runs
// lazily when the user navigates into a project.
//
// Concurrency: dedupes by deviceId. A second call with an in-flight promise
// joins the existing one. Errors do not mutate `Device.projects`; the
// caller can render a banner and retry.
//
// The caller passes the `DaemonClient` instance; this module does not own
// the connection lifecycle. `client.listProjects()` requires the underlying
// daemon to already be connected — see `lib/connection/pool.ts`.

import type { HostProject } from "@scorel/protocol";

import type { DeviceProject } from "../domain/devices";
import type { DevicesStore } from "../store/devices";

export type ProjectsClient = {
  listProjects(): Promise<HostProject[]>;
};

export type SyncProjectsArgs = {
  client: ProjectsClient;
  store: DevicesStore;
  deviceId: string;
};

const inflight = new Map<string, Promise<HostProject[]>>();

export async function syncProjects(
  args: SyncProjectsArgs,
): Promise<HostProject[]> {
  const existing = inflight.get(args.deviceId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const projects = await args.client.listProjects();
      const next: DeviceProject[] = projects.map(toDeviceProject);
      args.store.setProjects(args.deviceId, next);
      return projects;
    } finally {
      // Always clear so a follow-up request can fire even if this one
      // rejected. The catch path above is already silent (we let errors
      // propagate); the finally only releases the dedupe slot.
      inflight.delete(args.deviceId);
    }
  })();

  inflight.set(args.deviceId, promise);
  return promise;
}

function toDeviceProject(summary: HostProject): DeviceProject {
  return {
    projectId: summary.projectId,
    displayName: summary.displayName,
    workDir: summary.workDir,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

// Test seam: clear the in-flight dedupe map between cases.
export function __resetSyncProjectsForTests(): void {
  inflight.clear();
}
