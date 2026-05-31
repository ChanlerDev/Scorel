"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { DeviceSessionSummary } from "../../lib/domain/devices";
import { formatRelativeTime } from "../../lib/format/relative-time";

export type SessionNodeProps = {
  deviceId: string;
  projectSlug: string;
  session: DeviceSessionSummary;
  isActive?: boolean;
};

// Single-minute tick: for the typical sidebar (<100 sessions), one timer per
// row is fine. Each instance keeps its own `now` state so renders stay local.
// SSR: `now === null` until the effect runs on the client; that means the
// server-rendered first paint emits no hint, dodging hydration mismatch from
// `Date.now()` differing between server and client.
export function SessionNode({
  deviceId,
  projectSlug,
  session,
  isActive,
}: SessionNodeProps): JSX.Element {
  // Daemon-emitted slugs are URL-safe per S0031 but encode defensively in
  // case future slugs include reserved characters.
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(
    projectSlug,
  )}/sessions/${encodeURIComponent(session.sessionId)}`;
  const label = session.title?.trim() || session.sessionId;

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hint =
    now !== null && session.updatedAt !== undefined
      ? formatRelativeTime(session.updatedAt, now)
      : "";

  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs hover:bg-surface-hover ${
          isActive ? "bg-surface-hover font-medium text-text" : "text-muted"
        }`}
        title={label}
      >
        <span className="truncate">{label}</span>
        {hint ? <span className="shrink-0 text-faint">{hint}</span> : null}
      </Link>
    </li>
  );
}
