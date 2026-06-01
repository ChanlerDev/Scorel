// syncSessions: pulls daemon-truth session summaries for a single project
// (per S0036) and writes them into `DeviceProject.sessions`. Triggered
// lazily when the user navigates into a project node — see
// `app/devices/[deviceId]/projects/[projectId]/page.tsx`.
//
// Concurrency: dedupes per `(deviceId, projectId)` key. Errors do not
// erase the cached session map; the caller renders a banner and retries.
//
// S0045: when `client.listSessions` rejects with the public marker error
// (`code === "transport_disconnected"`), this helper rethrows a sentinel
// `Error` whose message is prefixed `disconnected: …` so the existing
// `setSessionsSyncError` path can surface a friendly message in the UI
// without leaking the raw `WsTransport is not connected` text.

import type { DaemonClient } from "@scorel/client";
import { asProjectId, type SessionSummary } from "@scorel/protocol";

import type { DeviceSessionSummary } from "../domain/devices";
import type { DevicesStore } from "../store/devices";

export const DEFAULT_SESSION_LIMIT = 200;

export type SyncSessionsArgs = {
  client: DaemonClient;
  store: DevicesStore;
  deviceId: string;
  projectId: string;
  limit?: number;
};

const inflight = new Map<string, Promise<DeviceSessionSummary[]>>();

function dedupeKey(deviceId: string, projectId: string): string {
  return `${deviceId} ${projectId}`;
}

function isTransportDisconnected(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "transport_disconnected"
  );
}

export async function syncSessions(
  args: SyncSessionsArgs,
): Promise<DeviceSessionSummary[]> {
  const key = dedupeKey(args.deviceId, args.projectId);
  const existing = inflight.get(key);
  if (existing) return existing;

  const limit = args.limit ?? DEFAULT_SESSION_LIMIT;
  const promise = (async () => {
    try {
      const summaries = await args.client.listSessions({
        projectId: asProjectId(args.projectId),
        limit,
      });
      const map: Record<string, DeviceSessionSummary> = {};
      for (const summary of summaries) {
        const id = String(summary.sessionId);
        map[id] = toDeviceSessionSummary(summary);
      }
      args.store.setProjectSessions(args.deviceId, args.projectId, map);
      return Object.values(map);
    } catch (cause) {
      if (isTransportDisconnected(cause)) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const err = new Error(`disconnected: ${message}`);
        (err as Error & { code?: string }).code = "transport_disconnected";
        throw err;
      }
      throw cause;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

function toDeviceSessionSummary(summary: SessionSummary): DeviceSessionSummary {
  const out: DeviceSessionSummary = {
    sessionId: String(summary.sessionId),
    updatedAt: summary.updatedAt,
    currentSeq: Number(summary.currentSeq),
  };
  if (summary.title !== undefined) out.title = summary.title;
  if (summary.model !== undefined) out.model = summary.model;
  return out;
}

// Test seam.
export function __resetSyncSessionsForTests(): void {
  inflight.clear();
}
