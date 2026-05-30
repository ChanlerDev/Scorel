"use client";

import Link from "next/link";
import { useEffect } from "react";

import {
  useConnection,
  useSessionsSyncError,
} from "../../../../../lib/connection/use-connection";
import { useDevices } from "../../../../../lib/store/use-devices";
import type {
  Device,
  DeviceSessionSummary,
} from "../../../../../lib/domain/devices";

type Params = { deviceId: string; projectSlug: string };

export default function ProjectPage({ params }: { params: Params }) {
  const { devices } = useDevices();
  const deviceId = decodeURIComponent(params.deviceId);
  const projectSlug = decodeURIComponent(params.projectSlug);
  const device = devices.find((d) => d.id === deviceId);

  if (!device) {
    return (
      <div className="p-6 text-sm text-zinc-600">
        <p className="font-medium text-zinc-800">Device not found</p>
        <p className="mt-2">
          <Link href="/" className="text-zinc-700 underline hover:text-zinc-900">
            Back to home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <ProjectView device={device} projectSlug={projectSlug} />
  );
}

function ProjectView({
  device,
  projectSlug,
}: {
  device: Device;
  projectSlug: string;
}) {
  const { state, syncSessionsNow } = useConnection(device);
  const error = useSessionsSyncError(device.id, projectSlug);
  const project = device.projects?.find((p) => p.projectSlug === projectSlug);

  useEffect(() => {
    if (state.name !== "connected") return;
    void syncSessionsNow(projectSlug);
  }, [state.name, projectSlug, syncSessionsNow]);

  const sessions = sortSessions(project?.sessions);

  return (
    <div className="p-6 space-y-4 text-sm text-zinc-700">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          {device.name} · {device.link}
        </p>
        <h1 className="text-base font-semibold text-zinc-900">
          {project?.displayName ?? projectSlug}
        </h1>
        {project?.workDirHint ? (
          <p className="text-xs text-zinc-500">{project.workDirHint}</p>
        ) : null}
      </header>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <span>Failed to load sessions: {error}</span>
          <button
            type="button"
            onClick={() => {
              void syncSessionsNow(projectSlug);
            }}
            disabled={state.name !== "connected"}
            className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!project ? (
        <p className="text-xs italic text-zinc-500">
          {state.name === "connected"
            ? "Loading project metadata…"
            : "Project not in cache; connect to load."}
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          No sessions yet — start a New Chat (coming soon).
        </p>
      ) : (
        <ul className="space-y-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              deviceId={device.id}
              projectSlug={projectSlug}
              session={session}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionRow({
  deviceId,
  projectSlug,
  session,
}: {
  deviceId: string;
  projectSlug: string;
  session: DeviceSessionSummary;
}) {
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(
    projectSlug,
  )}/sessions/${encodeURIComponent(session.sessionId)}`;
  const label = session.title?.trim() || session.sessionId;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-zinc-900">{label}</p>
          <p className="truncate text-xs text-zinc-500">
            {session.model ?? "—"}
            {session.updatedAt ? ` · ${formatTimestamp(session.updatedAt)}` : ""}
          </p>
        </div>
        {typeof session.currentSeq === "number" ? (
          <span className="ml-3 shrink-0 text-xs text-zinc-500">
            seq {session.currentSeq}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

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

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}
