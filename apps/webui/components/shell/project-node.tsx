"use client";

import { useEffect, useRef } from "react";

import type {
  DeviceProject,
  DeviceSessionSummary,
} from "../../lib/domain/devices";
import { useCollapsed } from "../../lib/store/use-collapsed";
import { SessionNode } from "./session-node";

export type ProjectNodeProps = {
  deviceId: string;
  project: DeviceProject;
  /** When this project is the active one, identifies the active session
   * (used to highlight the row). */
  activeSessionId?: string;
  /** Disable interactivity in offline mode (we still render the row, just
   * don't refire `syncSessions` when the device is unreachable). */
  offline?: boolean;
  /** Click hook — fires when the user expands a project so the sidebar can
   * lazy-trigger `syncSessions`. Does NOT fire on collapse. Also fires once
   * on mount when the project is initially expanded but has no cached
   * sessions yet (so reload + already-expanded still primes the cache). */
  onSelect?(deviceId: string, projectSlug: string): void;
};

/** Sort sessions newest first by `updatedAt`. Stable across re-renders. */
function sortSessions(
  sessions: Record<string, DeviceSessionSummary> | undefined,
): DeviceSessionSummary[] {
  if (!sessions) return [];
  return Object.values(sessions).sort((a, b) => {
    const left = a.updatedAt ?? 0;
    const right = b.updatedAt ?? 0;
    return right - left;
  });
}

export function ProjectNode({
  deviceId,
  project,
  activeSessionId,
  offline,
  onSelect,
}: ProjectNodeProps): JSX.Element {
  const sessions = sortSessions(project.sessions);
  const id = `project:${deviceId}/${project.projectSlug}`;
  const [collapsed, toggle] = useCollapsed(id);

  // S0045 mitigation for the `onSelect` semantics flip: previously every
  // <Link> click fired `onSelect`, so `syncSessions` ran on first navigation.
  // Now `onSelect` only fires on expand. If the user reloads with a project
  // that's already expanded but has no cached sessions, fire once on mount so
  // the project still primes its session list.
  const mountFiredRef = useRef(false);
  useEffect(() => {
    if (mountFiredRef.current) return;
    if (collapsed) return;
    if (offline) return;
    if (project.sessions !== undefined) return;
    mountFiredRef.current = true;
    onSelect?.(deviceId, project.projectSlug);
  }, [collapsed, offline, project.sessions, deviceId, project.projectSlug, onSelect]);

  const sessionCount =
    project.sessionCount !== undefined
      ? project.sessionCount
      : project.sessions
      ? Object.keys(project.sessions).length
      : undefined;

  function handleClick(): void {
    // Fire `onSelect` only when transitioning from collapsed → expanded; keep
    // collapse a pure UI toggle so users don't refetch on every click. Skip
    // the fire when offline so we don't queue work for an unreachable device.
    if (collapsed && !offline) {
      onSelect?.(deviceId, project.projectSlug);
    }
    toggle();
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-text hover:bg-surface-hover"
      >
        <span className="truncate">
          {project.displayName ?? project.projectSlug}
        </span>
        {sessionCount !== undefined ? (
          <span className="shrink-0 text-xs text-faint">{sessionCount}</span>
        ) : null}
      </button>
      {!collapsed && sessions.length > 0 ? (
        <ul className="ml-2 mt-0.5 space-y-0.5">
          {sessions.map((session) => (
            <SessionNode
              key={session.sessionId}
              deviceId={deviceId}
              projectSlug={project.projectSlug}
              session={session}
              isActive={activeSessionId === session.sessionId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
