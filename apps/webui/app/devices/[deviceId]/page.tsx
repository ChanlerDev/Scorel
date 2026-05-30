"use client";

import Link from "next/link";

import { useConnection } from "../../../lib/connection/use-connection";
import { useDevices } from "../../../lib/store/use-devices";
import type { Device } from "../../../lib/domain/devices";
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
  const { state, reconnect, disconnect } = useConnection(device);

  return (
    <div className="p-6 space-y-4 text-sm text-zinc-700">
      <header>
        <h1 className="text-base font-semibold text-zinc-900">{device.name}</h1>
        <p className="mt-1 text-xs text-zinc-500">{device.link}</p>
      </header>

      <Banner device={device} state={state} onReconnect={reconnect} onDisconnect={disconnect} />

      <p className="text-xs text-zinc-500">No projects synced yet (project listing arrives in the next milestone).</p>
    </div>
  );
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
