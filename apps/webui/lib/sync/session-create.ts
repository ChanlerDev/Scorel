// createSessionForProject: ask the daemon to mint a fresh `sessionId` under a
// given project slug, then optimistically prepend a `DeviceSessionSummary`
// stub to the local cache so the sidebar / project list update before the
// next `list_sessions` round-trip.
//
// Per S0039: New Chat does not allow the user to override `cwd`; the daemon
// uses its own startup cwd. The first user message will materialize the
// session JSONL on disk via the existing `create_session` flow on the daemon.
//
// Failure path: any rejection bubbles up untouched and the cache is NOT
// mutated. The caller is expected to render a banner and retry.

import type { DaemonClient } from "@scorel/client";

import type { DeviceSessionSummary } from "../domain/devices";
import type { DevicesStore } from "../store/devices";

export type CreateSessionForProjectArgs = {
  client: DaemonClient;
  store: DevicesStore;
  deviceId: string;
  projectSlug: string;
  /** Defaults applied to the optimistic cache row and the daemon
   * `create_session` meta. `model` is mirrored back via subsequent
   * `list_sessions` syncs once the daemon writes the header. */
  defaults?: { model?: string; title?: string };
};

export type CreateSessionForProjectResult = { sessionId: string };

export const NEW_CHAT_DEFAULT_TITLE = "New chat";

export async function createSessionForProject(
  args: CreateSessionForProjectArgs,
): Promise<CreateSessionForProjectResult> {
  const title = args.defaults?.title ?? NEW_CHAT_DEFAULT_TITLE;
  const meta: { projectSlug: string; title: string; model?: string } = {
    projectSlug: args.projectSlug,
    title,
  };
  if (args.defaults?.model !== undefined) {
    meta.model = args.defaults.model;
  }

  // Daemon allocates the sessionId; failures (network/auth/protocol) reject
  // here and we leave the local cache untouched. Tests cover both paths.
  const sessionId = await args.client.createSession({ meta });
  const idStr = String(sessionId);

  const summary: DeviceSessionSummary = {
    sessionId: idStr,
    title,
    updatedAt: Date.now(),
    currentSeq: 0,
  };
  if (args.defaults?.model !== undefined) {
    summary.model = args.defaults.model;
  }

  const merged = mergeSession(args.store, args.deviceId, args.projectSlug, summary);
  args.store.setProjectSessions(args.deviceId, args.projectSlug, merged);

  return { sessionId: idStr };
}

/**
 * Merge a fresh session summary into the (device, project) session map.
 * Existing sessions are preserved; the new entry takes precedence on
 * collision (the daemon should mint unique ids, but we don't depend on it).
 * The project view sorts by `updatedAt` desc so the new entry — stamped with
 * `Date.now()` — surfaces at the top without us reordering keys here.
 */
function mergeSession(
  store: DevicesStore,
  deviceId: string,
  projectSlug: string,
  summary: DeviceSessionSummary,
): Record<string, DeviceSessionSummary> {
  const device = store.get(deviceId);
  const project = device?.projects?.find((p) => p.projectSlug === projectSlug);
  const existing = project?.sessions ?? {};
  return { ...existing, [summary.sessionId]: summary };
}
