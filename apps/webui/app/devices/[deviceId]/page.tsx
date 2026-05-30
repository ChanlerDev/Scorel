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

  return <DeviceConnected device={device} />;
}

function DeviceConnected({ device }: { device: Device }) {
  const { state, reconnect, disconnect, syncProjectsNow } = useConnection(device);
  const projectsError = useProjectsSyncError(device.id);

  return (
    <div className="p-6 space-y-4 text-sm text-zinc-700">
      <header>
        <h1 className="text-base font-semibold text-zinc-900">{device.name}</h1>
        <p className="mt-1 text-xs text-zinc-500">{device.link}</p>
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
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">Projects</h2>
        {device.projectsFetchedAt ? (
          <span className="text-[10px] text-zinc-400">
            synced {formatTimestamp(device.projectsFetchedAt)}
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <span>Failed to load projects: {error}</span>
          <button
            type="button"
            onClick={onRetry}
            disabled={state.name !== "connected"}
            className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      ) : null}
      {projects.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
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
        className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-zinc-900">
            {project.displayName ?? project.projectSlug}
          </p>
          {project.workDirHint ? (
            <p className="truncate text-xs text-zinc-500">{project.workDirHint}</p>
          ) : null}
        </div>
        {project.sessionCount !== undefined ? (
          <span className="ml-3 shrink-0 text-xs text-zinc-500">
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
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Reconnect
            </button>
          </div>
        </BannerShell>
      );
    case "connecting":
      return <BannerShell tone="amber">Connecting…</BannerShell>;
    case "reconnecting":
      return (
        <BannerShell tone="amber">
          Reconnecting (attempt {state.attempt})…
        </BannerShell>
      );
    case "connected": {
      const name =
        state.remoteIdentity.deviceDisplayName ??
        state.remoteIdentity.deviceId ??
        "remote daemon";
      return (
        <BannerShell tone="emerald">
          <div className="flex items-center justify-between gap-3">
            <span>Connected as {name}</span>
            <button
              type="button"
              onClick={onDisconnect}
              className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
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
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Reconnect
            </button>
          </div>
        </BannerShell>
      );
    case "error": {
      if (state.reason === "auth") {
        return (
          <BannerShell tone="red">
            <div className="flex items-center justify-between gap-3">
              <span>Token rejected; update token in Settings.</span>
              <Link
                href={`/settings/devices/${device.id}`}
                className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Open Settings
              </Link>
            </div>
          </BannerShell>
        );
      }
      if (state.reason === "version_mismatch") {
        return (
          <BannerShell tone="red">
            Daemon protocol version unsupported; upgrade required.
          </BannerShell>
        );
      }
      if (state.reason === "network") {
        return (
          <BannerShell tone="red">
            <div className="flex items-center justify-between gap-3">
              <span>Cannot reach {hostnameOf(device.link)}; will retry.</span>
              <button
                type="button"
                onClick={onReconnect}
                className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Reconnect
              </button>
            </div>
          </BannerShell>
        );
      }
      return (
        <BannerShell tone="red">
          <div className="flex items-center justify-between gap-3">
            <span>{state.message}</span>
            <button
              type="button"
              onClick={onReconnect}
              className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
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
  muted: "border-zinc-200 bg-zinc-50 text-zinc-700",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  red: "border-red-300 bg-red-50 text-red-900",
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
