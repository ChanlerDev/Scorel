"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { NewChatButton } from "../../../../../components/shell/new-chat-button";
import {
  useConnection,
  useSessionsSyncError,
} from "../../../../../lib/connection/use-connection";
import { useDevices } from "../../../../../lib/store/use-devices";
import type {
  Device,
  DeviceSessionSummary,
} from "../../../../../lib/domain/devices";

type Params = { deviceId: string; projectId: string };

export default function ProjectPage({ params }: { params: Params }) {
  const { devices } = useDevices();
  const deviceId = decodeURIComponent(params.deviceId);
  const projectId = decodeURIComponent(params.projectId);
  const device = devices.find((d) => d.id === deviceId);

  if (!device) {
    return (
      <div className="p-6 text-sm text-muted">
        <p className="font-medium text-text">Device not found</p>
        <p className="mt-2">
          <Link href="/" className="text-accent underline hover:text-accent-hover">
            Back to home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <ProjectView device={device} projectId={projectId} />
  );
}

function ProjectView({
  device,
  projectId,
}: {
  device: Device;
  projectId: string;
}) {
  const { state, syncSessionsNow } = useConnection(device);
  const error = useSessionsSyncError(device.id, projectId);
  const project = device.projects?.find((p) => p.projectId === projectId);
  const previousStateName = useRef(state.name);

  useEffect(() => {
    const previous = previousStateName.current;
    previousStateName.current = state.name;
    if (state.name !== "connected" || previous === "connected") return;
    void syncSessionsNow(projectId);
  }, [state.name, projectId, syncSessionsNow]);

  const sessions = sortSessions(project?.sessions);

  return (
    <div className="p-6 space-y-4 text-sm text-text">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted">
          {device.name} · {device.link}
        </p>
        <h1 className="text-lg font-semibold text-text">
          {project?.displayName ?? projectId}
        </h1>
        {project?.workDir ? (
          <p className="text-xs text-faint">{project.workDir}</p>
        ) : null}
      </header>

      <NewChatButton
        deviceId={device.id}
        projectId={projectId}
        variant="page"
      />

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-status-err bg-surface-raised px-3 py-2 text-sm text-status-err">
          <span>Failed to load sessions: {error}</span>
          <button
            type="button"
            onClick={() => {
              void syncSessionsNow(projectId);
            }}
            disabled={state.name !== "connected"}
            className="rounded-md border border-status-err bg-surface-raised px-2 py-1 text-xs font-medium text-status-err hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!project ? (
        <p className="text-xs italic text-muted">
          {state.name === "connected"
            ? "Loading project metadata…"
            : "Project not in cache; connect to load."}
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-xs italic text-muted">
          No sessions yet — click + New Chat above to start one.
        </p>
      ) : (
        <ul className="space-y-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              deviceId={device.id}
              projectId={projectId}
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
  projectId,
  session,
}: {
  deviceId: string;
  projectId: string;
  session: DeviceSessionSummary;
}) {
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(
    projectId,
  )}/sessions/${encodeURIComponent(session.sessionId)}`;
  const label = session.title?.trim() || session.sessionId;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md border border-subtle bg-surface-raised px-3 py-2 hover:bg-accent-soft"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-text">{label}</p>
          <p className="truncate text-xs text-faint">
            {session.model ?? "—"}
            {session.updatedAt ? ` · ${formatTimestamp(session.updatedAt)}` : ""}
          </p>
        </div>
        {typeof session.currentSeq === "number" ? (
          <span className="ml-3 shrink-0 text-xs text-muted">
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
