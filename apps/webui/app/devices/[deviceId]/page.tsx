"use client";

import Link from "next/link";

import {
  useConnection,
  useProjectsSyncError,
} from "../../../lib/connection/use-connection";
import { useDevices } from "../../../lib/store/use-devices";
import type { Device, DeviceProject } from "../../../lib/domain/devices";
import type { ConnectionState } from "../../../lib/connection/state";

type Params = { deviceId: string };

export default function DevicePage({ params }: { params: Params }) {
  const { devices } = useDevices();
  const device = devices.find((d) => d.id === params.deviceId);

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

  return <DeviceConnected device={device} />;
}

function DeviceConnected({ device }: { device: Device }) {
  const { state, reconnect, disconnect, syncProjectsNow } = useConnection(device);
  const projectsError = useProjectsSyncError(device.id);

  return (
    <div className="p-6 space-y-4 text-sm text-text">
      <header>
        <h1 className="text-lg font-semibold text-text">{device.name}</h1>
        <p className="mt-1 text-xs text-faint">{device.link}</p>
      </header>

      <Banner device={device} state={state} onReconnect={reconnect} onDisconnect={disconnect} />

      <ProjectListSection
        device={device}
        state={state}
        error={projectsError}
        onRetry={() => {
          void syncProjectsNow();
        }}
      />
    </div>
  );
}

function ProjectListSection({
  device,
  state,
  error,
  onRetry,
}: {
  device: Device;
  state: ConnectionState;
  error?: string;
  onRetry: () => void;
}) {
  const projects = device.projects ?? [];
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          Projects
        </h2>
        {device.projectsFetchedAt ? (
          <span className="text-[10px] text-faint">
            synced {formatTimestamp(device.projectsFetchedAt)}
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-status-err bg-surface-raised px-3 py-2 text-sm text-status-err">
          <span>Failed to load projects: {error}</span>
          <button
            type="button"
            onClick={onRetry}
            disabled={state.name !== "connected"}
            className="rounded-md border border-status-err bg-surface-raised px-2 py-1 text-xs font-medium text-status-err hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      ) : null}
      {projects.length === 0 ? (
        <p className="text-xs italic text-muted">
          {state.name === "connected"
            ? "No projects yet — try sending a message from the CLI to populate this list."
            : device.lastConnectedAt
            ? "No projects cached from previous connections."
            : "Not connected yet."}
        </p>
      ) : (
        <ul className="space-y-1">
          {projects.map((project) => (
            <ProjectRow key={project.projectSlug} deviceId={device.id} project={project} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({
  deviceId,
  project,
}: {
  deviceId: string;
  project: DeviceProject;
}) {
  const href = `/devices/${encodeURIComponent(deviceId)}/projects/${encodeURIComponent(
    project.projectSlug,
  )}`;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md border border-subtle bg-surface-raised px-3 py-2 hover:bg-accent-soft"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-text">
            {project.displayName ?? project.projectSlug}
          </p>
          {project.workDirHint ? (
            <p className="truncate text-xs text-faint">{project.workDirHint}</p>
          ) : null}
        </div>
        {project.sessionCount !== undefined ? (
          <span className="ml-3 shrink-0 text-xs text-muted">
            {project.sessionCount} session{project.sessionCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function hostnameOf(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

function Banner({
  device,
  state,
  onReconnect,
  onDisconnect,
}: {
  device: Device;
  state: ConnectionState;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  switch (state.name) {
    case "idle":
      return (
        <BannerShell tone="muted">
          <div className="flex items-center justify-between gap-3">
            <span>Idle.</span>
            <button
              type="button"
              onClick={onReconnect}
              className="rounded-md border border-subtle bg-surface-raised px-3 py-1 text-xs font-medium text-muted hover:border-border-strong hover:text-text"
            >
              Reconnect
            </button>
          </div>
        </BannerShell>
      );
    case "connecting":
      return <BannerShell tone="warn">Connecting…</BannerShell>;
    case "reconnecting":
      return (
        <BannerShell tone="warn">
          Reconnecting (attempt {state.attempt})…
        </BannerShell>
      );
    case "connected": {
      const name =
        state.remoteIdentity.deviceDisplayName ??
        state.remoteIdentity.deviceId ??
        "remote daemon";
      return (
        <BannerShell tone="ok">
          <div className="flex items-center justify-between gap-3">
            <span>Connected as {name}</span>
            <button
              type="button"
              onClick={onDisconnect}
              className="rounded-md border border-status-ok bg-surface-raised px-3 py-1 text-xs font-medium text-status-ok hover:bg-accent-soft"
            >
              Disconnect
            </button>
          </div>
        </BannerShell>
      );
    }
    case "disconnected":
      return (
        <BannerShell tone="muted">
          <div className="flex items-center justify-between gap-3">
            <span>Disconnected.</span>
            <button
              type="button"
              onClick={onReconnect}
              className="rounded-md border border-subtle bg-surface-raised px-3 py-1 text-xs font-medium text-muted hover:border-border-strong hover:text-text"
            >
              Reconnect
            </button>
          </div>
        </BannerShell>
      );
    case "error": {
      if (state.reason === "auth") {
        return (
          <BannerShell tone="err">
            <div className="flex items-center justify-between gap-3">
              <span>Token rejected; update token in Settings.</span>
              <Link
                href={`/settings/devices/${device.id}`}
                className="rounded-md border border-status-err bg-surface-raised px-3 py-1 text-xs font-medium text-status-err hover:bg-accent-soft"
              >
                Open Settings
              </Link>
            </div>
          </BannerShell>
        );
      }
      if (state.reason === "version_mismatch") {
        return (
          <BannerShell tone="err">
            Daemon protocol version unsupported; upgrade required.
          </BannerShell>
        );
      }
      if (state.reason === "network") {
        return (
          <BannerShell tone="err">
            <div className="flex items-center justify-between gap-3">
              <span>Cannot reach {hostnameOf(device.link)}; will retry.</span>
              <button
                type="button"
                onClick={onReconnect}
                className="rounded-md border border-status-err bg-surface-raised px-3 py-1 text-xs font-medium text-status-err hover:bg-accent-soft"
              >
                Reconnect
              </button>
            </div>
          </BannerShell>
        );
      }
      return (
        <BannerShell tone="err">
          <div className="flex items-center justify-between gap-3">
            <span>{state.message}</span>
            <button
              type="button"
              onClick={onReconnect}
              className="rounded-md border border-status-err bg-surface-raised px-3 py-1 text-xs font-medium text-status-err hover:bg-accent-soft"
            >
              Reconnect
            </button>
          </div>
        </BannerShell>
      );
    }
  }
}

const TONE_CLASSES = {
  muted: "border-subtle bg-surface text-muted",
  warn: "border-status-warn bg-surface-raised text-status-warn",
  ok: "border-status-ok bg-surface-raised text-status-ok",
  err: "border-status-err bg-surface-raised text-status-err",
} as const;

function BannerShell({
  tone,
  children,
}: {
  tone: keyof typeof TONE_CLASSES;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${TONE_CLASSES[tone]}`}>
      {children}
    </div>
  );
}
