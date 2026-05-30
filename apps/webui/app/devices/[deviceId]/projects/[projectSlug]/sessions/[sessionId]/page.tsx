"use client";

import Link from "next/link";
import { useEffect } from "react";

import {
  useConnection,
  useSessionsSyncError,
} from "../../../../../../../lib/connection/use-connection";
import { useDevices } from "../../../../../../../lib/store/use-devices";
import type {
  Device,
  DeviceSessionSummary,
} from "../../../../../../../lib/domain/devices";

type Params = { deviceId: string; projectSlug: string; sessionId: string };

export default function SessionPage({ params }: { params: Params }) {
  const { devices } = useDevices();
  const deviceId = decodeURIComponent(params.deviceId);
  const projectSlug = decodeURIComponent(params.projectSlug);
  const sessionId = decodeURIComponent(params.sessionId);
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
    <SessionView
      device={device}
      projectSlug={projectSlug}
      sessionId={sessionId}
    />
  );
}

function SessionView({
  device,
  projectSlug,
  sessionId,
}: {
  device: Device;
  projectSlug: string;
  sessionId: string;
}) {
  const { state, syncSessionsNow } = useConnection(device);
  const error = useSessionsSyncError(device.id, projectSlug);
  const project = device.projects?.find((p) => p.projectSlug === projectSlug);
  const session: DeviceSessionSummary | undefined =
    project?.sessions?.[sessionId];

  // Deep-link entry point: if we don't yet have the session in cache, trigger
  // a session sync so the header below has metadata. The chatbox attach
  // itself lands in S0037.
  useEffect(() => {
    if (state.name !== "connected") return;
    if (project?.sessions && session) return;
    void syncSessionsNow(projectSlug);
  }, [state.name, project?.sessions, session, projectSlug, syncSessionsNow]);

  return (
    <div className="p-6 space-y-4 text-sm text-zinc-700">
      <SessionHeader
        device={device}
        projectSlug={projectSlug}
        sessionId={sessionId}
        session={session}
      />

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          Failed to load session metadata: {error}
        </div>
      ) : null}

      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-zinc-500">
        Chatbox not implemented yet (S0037).
      </div>
    </div>
  );
}

function SessionHeader({
  device,
  projectSlug,
  sessionId,
  session,
}: {
  device: Device;
  projectSlug: string;
  sessionId: string;
  session: DeviceSessionSummary | undefined;
}) {
  const projectHref = `/devices/${encodeURIComponent(device.id)}/projects/${encodeURIComponent(
    projectSlug,
  )}`;
  if (!session) {
    return (
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          {device.name} ·{" "}
          <Link href={projectHref} className="underline hover:text-zinc-700">
            {projectSlug}
          </Link>
        </p>
        <h1 className="text-base font-semibold text-zinc-900">{sessionId}</h1>
        <p className="text-xs italic text-zinc-500">
          Loading session metadata…
        </p>
      </header>
    );
  }
  const title = session.title?.trim() || sessionId;
  return (
    <header className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-zinc-500">
        {device.name} ·{" "}
        <Link href={projectHref} className="underline hover:text-zinc-700">
          {projectSlug}
        </Link>
      </p>
      <h1 className="text-base font-semibold text-zinc-900">{title}</h1>
      <p className="text-xs text-zinc-500">
        {session.model ?? "model unknown"}
        {session.updatedAt ? ` · updated ${formatTimestamp(session.updatedAt)}` : ""}
        {typeof session.currentSeq === "number"
          ? ` · seq ${session.currentSeq}`
          : ""}
      </p>
    </header>
  );
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}
