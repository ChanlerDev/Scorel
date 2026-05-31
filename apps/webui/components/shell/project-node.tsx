"use client";

import Link from "next/link";

import type {
  DeviceProject,
  DeviceSessionSummary,
} from "../../lib/domain/devices";
import { useCollapsed } from "../../lib/store/use-collapsed";
import { CollapseToggle } from "./collapse-toggle";
import { SessionNode } from "./session-node";

export type ProjectNodeProps = {
  deviceId: string;
  project: DeviceProject;
  /** True when this project's slug matches the active route. Used to
   * highlight the row; expansion is now driven solely by the persisted
   * collapse map. */
  isActive?: boolean;
  /** When this project is the active one, identifies the active session
   * (used to highlight the row). */
  activeSessionId?: string;
  /** Disable interactivity in offline mode (we still render the row, just
   * don't refire `syncSessions` when the device is unreachable). */
  offline?: boolean;
  /** Click hook — used by the sidebar to fire `syncSessions` lazily. */
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
  isActive,
  activeSessionId,
  offline,
  onSelect,
}: ProjectNodeProps) {
  const sessions = sortSessions(project.sessions);
  const id = `project:${deviceId}/${project.projectSlug}`;
  const [collapsed] = useCollapsed(id);
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(
    project.projectSlug,
  )}`;

  return (
    <li>
      <div className="flex items-center gap-1">
        <CollapseToggle id={id} />
        <Link
          href={href}
          onClick={() => {
            if (!offline) onSelect?.(deviceId, project.projectSlug);
          }}
          aria-current={isActive ? "page" : undefined}
          className={`flex flex-1 items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-hover ${
            isActive ? "bg-surface-hover font-medium text-text" : "text-text"
          }`}
        >
          <span className="truncate text-sm">
            {project.displayName ?? project.projectSlug}
          </span>
          {project.sessionCount !== undefined ? (
            <span className="shrink-0 text-xs text-faint">
              {project.sessionCount}
            </span>
          ) : null}
        </Link>
      </div>
      {!collapsed && sessions.length > 0 ? (
        <ul className="ml-5 mt-1 space-y-0.5">
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
