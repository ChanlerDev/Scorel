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
  type QueuePreviewItem,
  type ProjectorState,
} from "../../../../../../../lib/events/projector";
import { buildConnectionSummary } from "../../../../../../../lib/diagnostics/connection-summary";
import { computeScopeKey } from "../../../../../../../lib/identity/scope-key";
import { getSharedAttachCache } from "../../../../../../../lib/store";
import type { RunningMessageBehavior } from "../../../../../../../lib/store/running-behavior";
import { useDevices } from "../../../../../../../lib/store/use-devices";
import { useRunningBehavior } from "../../../../../../../lib/store/use-running-behavior";
import type { Device } from "../../../../../../../lib/domain/devices";
import { asSessionId, type QueueItem } from "@scorel/protocol";

type Params = { deviceId: string; projectId: string; sessionId: string };

export default function SessionPage({ params }: { params: Params }) {
  const { devices } = useDevices();
  const deviceId = decodeURIComponent(params.deviceId);
  const projectId = decodeURIComponent(params.projectId);
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
      projectId={projectId}
      sessionId={sessionId}
    />
  );
}

function SessionView({
  device,
  projectId,
  sessionId,
}: {
  device: Device;
  projectId: string;
  sessionId: string;
}) {
  const { state: connState, managed, syncSessionsNow } = useConnection(device);
  const error = useSessionsSyncError(device.id, projectId);
  const project = device.projects?.find((p) => p.projectId === projectId);
  const session = project?.sessions?.[sessionId];
  const searchParams = useSearchParams();
  const debugEnabled = searchParams?.get("debug") === "1";

  // Pull session metadata if it's not already cached.
  useEffect(() => {
    if (connState.name !== "connected") return;
    if (project?.sessions && session) return;
    void syncSessionsNow(projectId);
  }, [connState.name, project?.sessions, session, projectId, syncSessionsNow]);

  const remoteDeviceId = device.remoteIdentity?.deviceId;

  // S0045: SessionHeader is gone — main area is transcript-first per the
  // ChatGPT-philosophy spec. The session id surfaces as a hover title in the
  // sidebar; the conversation itself names the room.
  return (
    <div className="flex h-full flex-col text-sm text-text">
      {error ? (
        <p className="px-6 pt-4 text-sm text-status-err" data-testid="session-error">
          {error.startsWith("disconnected:")
            ? "连接已断开。检查 daemon token 后刷新页面。"
            : `Failed to load session metadata: ${error}`}
        </p>
      ) : null}

      {!remoteDeviceId ? (
        <p className="flex h-full items-center justify-center text-sm text-muted">
          Connecting to daemon… (waiting for device identity)
        </p>
      ) : (
        <Chatbox
          device={device}
          remoteDeviceId={remoteDeviceId}
          projectId={projectId}
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
  projectId,
  sessionId,
  managed,
  connectionState,
  debugEnabled,
}: {
  device: Device;
  remoteDeviceId: string;
  projectId: string;
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
  const { behavior: runningBehavior } = useRunningBehavior();
  const controllerRef = useRef<SessionAttachController | null>(null);
  // S0046: one-shot consumer for the empty-composer's pending prompt. Once
  // the attach controller has finished its initial resync (snapshot.loading
  // flips to false), pull the stashed text and dispatch a single send. The
  // ref guards against re-firing across renders or HMR resets.
  const pendingConsumedRef = useRef(false);

  useEffect(() => {
    if (!managed) return;
    let cancelled = false;
    let controller: SessionAttachController | undefined;

    void (async () => {
      const scopeKey = await computeScopeKey(remoteDeviceId, projectId);
      if (cancelled) return;
      const attachCache = getSharedAttachCache();
      controller = createSessionAttachController({
        client: managed.client,
        scopeKey,
        sessionId: asSessionId(sessionId),
        projectId,
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
  }, [managed, remoteDeviceId, projectId, sessionId]);

  // S0046: drain the empty-composer pending prompt exactly once after the
  // controller is fully attached (loading=false ⇒ initial resync settled).
  // We key on sessionId so concurrent tabs do not collide; sessionStorage is
  // per-tab anyway, but the per-session key keeps the behaviour explicit.
  useEffect(() => {
    if (pendingConsumedRef.current) return;
    if (snapshot.loading) return;
    const controller = controllerRef.current;
    if (!controller) return;
    if (typeof window === "undefined") return;
    const key = `scorel.pending-prompt:${sessionId}`;
    const pending = window.sessionStorage.getItem(key);
    if (!pending) return;
    pendingConsumedRef.current = true;
    window.sessionStorage.removeItem(key);
    void controller.send(pending).catch(() => {
      // Errors propagate through `snapshot.error` (set by the attach
      // controller); no extra UI work needed here.
    });
  }, [snapshot.loading, sessionId]);

  const send = useMemo(
    () =>
      async (content: string, behavior?: RunningMessageBehavior): Promise<void> => {
        const controller = controllerRef.current;
        if (!controller) return;
        await controller.send(content, { runningBehavior: behavior });
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

  const rewriteQueue = useMemo(
    () =>
      async (queue: RunningMessageBehavior, items: QueuePreviewItem[]): Promise<void> => {
        const client = managed?.client;
        if (!client) return;
        await client.rewriteQueue(queue, items.map(toQueueItem));
      },
    [managed],
  );

  const errorBanner =
    snapshot.error?.reason === "cancel_failed"
      ? `${snapshot.error.reason}: ${snapshot.error.message}`
      : undefined;

  const debugSummary = debugEnabled
    ? buildConnectionSummary({ device, connectionState, snapshot })
    : null;
  const queues = snapshot.state.queues ?? { follow_up: [], steer: [] };

  // S0045: no card outer. Transcript + composer flow directly inside the
  // main area's `bg-bg`.
  return (
    <div className="flex h-full flex-col overflow-hidden">
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
        runningBehavior={runningBehavior}
        queuedItems={[...queues.follow_up, ...queues.steer]}
        onRewriteQueue={rewriteQueue}
      />
      {debugSummary ? <DebugPanel summary={debugSummary} /> : null}
    </div>
  );
}

function ChatboxBody({ snapshot }: { snapshot: SessionAttachSnapshot }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      {snapshot.error ? (
        <p
          className="px-6 py-2 text-xs text-status-err"
          data-testid="chatbox-error"
        >
          {snapshot.error.reason === "disconnected"
            ? "连接已断开。检查 daemon token 后刷新页面。"
            : `${snapshot.error.reason}: ${snapshot.error.message}`}
        </p>
      ) : null}
      <Transcript turns={snapshot.state.turns} />
    </div>
  );
}

// Type guard helper for ProjectorState if downstream consumers want it.
export type { ProjectorState };

function toQueueItem(item: QueuePreviewItem): QueueItem {
  return {
    id: item.id,
    content: item.content,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    clientId: item.clientId,
    data: item.data,
  };
}
