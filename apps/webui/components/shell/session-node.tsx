"use client";

import Link from "next/link";

import type { DeviceSessionSummary } from "../../lib/domain/devices";

export type SessionNodeProps = {
  deviceId: string;
  projectSlug: string;
  session: DeviceSessionSummary;
  isActive?: boolean;
};

export function SessionNode({
  deviceId,
  projectSlug,
  session,
  isActive,
}: SessionNodeProps) {
  // Daemon-emitted slugs are URL-safe per S0031 but encode defensively in
  // case future slugs include reserved characters.
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(
    projectSlug,
  )}/sessions/${encodeURIComponent(session.sessionId)}`;
  const label = session.title?.trim() || session.sessionId;
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`block truncate rounded-sm px-2 py-1 text-xs hover:bg-surface-hover ${
          isActive ? "bg-surface-hover font-medium text-text" : "text-muted"
        }`}
        title={label}
      >
        {label}
      </Link>
    </li>
  );
}
