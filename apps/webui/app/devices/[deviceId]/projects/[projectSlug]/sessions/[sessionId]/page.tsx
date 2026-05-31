"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Composer } from "../../../../../../../components/chatbox/composer";
import { DebugPanel } from "../../../../../../../components/chatbox/debug-panel";
import { Transcript } from "../../../../../../../components/chatbox/transcript";
import {
  useConnection,
  useSessionsSyncError,
} from "../../../../../../../lib/connection/use-connection";
import {
  createSessionAttachController,
  type SessionAttachController,
  type SessionAttachSnapshot,
} from "../../../../../../../lib/connection/session";
import {
  emptyProjectorState,
  type ProjectorState,
} from "../../../../../../../lib/events/projector";
import { buildConnectionSummary } from "../../../../../../../lib/diagnostics/connection-summary";
import { computeScopeKey } from "../../../../../../../lib/identity/scope-key";
import { getSharedAttachCache } from "../../../../../../../lib/store";
import { useDevices } from "../../../../../../../lib/store/use-devices";
import type {
  Device,
  DeviceSessionSummary,
} from "../../../../../../../lib/domain/devices";
import { asSessionId } from "@scorel/protocol";

type Params = { deviceId: string; projectSlug: string; sessionId: string };

export default function SessionPage({ params }: { params: Params }) {
  const { devices } = useDevices();
  const deviceId = decodeURIComponent(params.deviceId);
  const projectSlug = decodeURIComponent(params.projectSlug);
  const sessionId = decodeURIComponent(params.sessionId);
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
  const { state: connState, managed, syncSessionsNow } = useConnection(device);
  const error = useSessionsSyncError(device.id, projectSlug);
  const project = device.projects?.find((p) => p.projectSlug === projectSlug);
  const session: DeviceSessionSummary | undefined =
    project?.sessions?.[sessionId];
  const searchParams = useSearchParams();
  const debugEnabled = searchParams?.get("debug") === "1";

  // Pull session metadata if it's not already cached.
  useEffect(() => {
    if (connState.name !== "connected") return;
    if (project?.sessions && session) return;
    void syncSessionsNow(projectSlug);
  }, [connState.name, project?.sessions, session, projectSlug, syncSessionsNow]);

  const remoteDeviceId = device.remoteIdentity?.deviceId;

  return (
    <div className="flex h-full flex-col gap-3 p-6 text-sm text-text">
      <SessionHeader
        device={device}
        projectSlug={projectSlug}
        sessionId={sessionId}
        session={session}
      />

      {error ? (
        <div className="rounded-md border border-status-err bg-surface-raised px-3 py-2 text-sm text-status-err">
          Failed to load session metadata: {error}
        </div>
      ) : null}

      {!remoteDeviceId ? (
        <div className="rounded-md border border-dashed border-subtle bg-surface px-4 py-6 text-center text-muted">
          Connecting to daemon… (waiting for device identity)
        </div>
      ) : (
        <Chatbox
          device={device}
          remoteDeviceId={remoteDeviceId}
          projectSlug={projectSlug}
          sessionId={sessionId}
          managed={managed}
          connectionState={connState}
          debugEnabled={debugEnabled}
        />
      )}
    </div>
  );
}

function Chatbox({
  device,
  remoteDeviceId,
  projectSlug,
  sessionId,
  managed,
  connectionState,
  debugEnabled,
}: {
  device: Device;
  remoteDeviceId: string;
  projectSlug: string;
  sessionId: string;
  managed: ReturnType<typeof useConnection>["managed"];
  connectionState: ReturnType<typeof useConnection>["state"];
  debugEnabled: boolean;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<SessionAttachSnapshot>({
    loading: true,
    state: emptyProjectorState(),
    inFlight: false,
    cancelling: false,
    persistentLastSeq: 0,
    streamLastSeq: 0,
    sessionId,
  });
  const controllerRef = useRef<SessionAttachController | null>(null);

  useEffect(() => {
    if (!managed) return;
    let cancelled = false;
    let controller: SessionAttachController | undefined;

    void (async () => {
      const scopeKey = await computeScopeKey(remoteDeviceId, projectSlug);
      if (cancelled) return;
      const attachCache = getSharedAttachCache();
      controller = createSessionAttachController({
        client: managed.client,
        scopeKey,
        sessionId: asSessionId(sessionId),
        attachCache,
        onState: (next) => {
          if (cancelled) return;
          setSnapshot(next);
        },
      });
      controllerRef.current = controller;
      await controller.start();
    })();

    return () => {
      cancelled = true;
      controller?.stop();
      controllerRef.current = null;
    };
  }, [managed, remoteDeviceId, projectSlug, sessionId]);

  const send = useMemo(
    () =>
      async (content: string): Promise<void> => {
        const controller = controllerRef.current;
        if (!controller) return;
        await controller.send(content);
      },
    [],
  );

  const onCancel = useMemo(
    () => (): void => {
      const controller = controllerRef.current;
      if (!controller) return;
      void controller.cancel();
    },
    [],
  );

  const errorBanner =
    snapshot.error?.reason === "cancel_failed"
      ? `${snapshot.error.reason}: ${snapshot.error.message}`
      : undefined;

  const debugSummary = debugEnabled
    ? buildConnectionSummary({ device, connectionState, snapshot })
    : null;

  return (
    <div className="flex h-[60vh] min-h-[400px] flex-col overflow-hidden rounded-md border border-subtle bg-surface">
      <div className="flex-1 overflow-hidden">
        {snapshot.loading && snapshot.state.turns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm italic text-muted">
            Loading session…
          </div>
        ) : (
          <ChatboxBody snapshot={snapshot} />
        )}
      </div>
      <Composer
        onSend={send}
        onCancel={onCancel}
        inFlight={snapshot.inFlight}
        cancelling={snapshot.cancelling}
        errorBanner={errorBanner}
        disabled={!managed}
      />
      {debugSummary ? <DebugPanel summary={debugSummary} /> : null}
    </div>
  );
}

function ChatboxBody({ snapshot }: { snapshot: SessionAttachSnapshot }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      {snapshot.error ? (
        <div className="border-b border-status-err bg-surface-raised px-3 py-1 text-xs text-status-err">
          {snapshot.error.reason}: {snapshot.error.message}
        </div>
      ) : null}
      <Transcript turns={snapshot.state.turns} />
    </div>
  );
}

// Type guard helper for ProjectorState if downstream consumers want it.
export type { ProjectorState };

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
        <p className="text-xs uppercase tracking-wide text-muted">
          {device.name} ·{" "}
          <Link href={projectHref} className="underline hover:text-accent">
            {projectSlug}
          </Link>
        </p>
        <h1 className="text-lg font-semibold text-text">{sessionId}</h1>
        <p className="text-xs italic text-faint">
          Loading session metadata…
        </p>
      </header>
    );
  }
  const title = session.title?.trim() || sessionId;
  return (
    <header className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted">
        {device.name} ·{" "}
        <Link href={projectHref} className="underline hover:text-accent">
          {projectSlug}
        </Link>
      </p>
      <h1 className="text-lg font-semibold text-text">{title}</h1>
      <p className="text-xs text-faint">
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
