"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDevices } from "../../lib/store/use-devices";

type LocalDaemonInfo = {
  wsUrl: string;
  token: string;
  cwd: string;
  host: string;
  port: number;
};

type LocalDaemonState =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "present"; info: LocalDaemonInfo };

export function DeviceList() {
  const { devices, store } = useDevices();
  const router = useRouter();
  const [localDaemon, setLocalDaemon] = useState<LocalDaemonState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/local-daemon")
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setLocalDaemon({ status: "absent" });
          return;
        }
        const body = (await response.json()) as { ok?: boolean } & Partial<LocalDaemonInfo>;
        if (!body.ok || !body.wsUrl || !body.token || !body.cwd || !body.host || body.port === undefined) {
          setLocalDaemon({ status: "absent" });
          return;
        }
        setLocalDaemon({
          status: "present",
          info: {
            wsUrl: body.wsUrl,
            token: body.token,
            cwd: body.cwd,
            host: body.host,
            port: body.port,
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLocalDaemon({ status: "absent" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Suppress the banner once an existing device already covers the same
  // wsUrl + token pair so we don't pile up duplicates after a refresh.
  const matchingDevice =
    localDaemon.status === "present"
      ? devices.find(
          (device) => device.link === localDaemon.info.wsUrl && device.token === localDaemon.info.token,
        )
      : undefined;

  const handleAdoptLocalDaemon = () => {
    if (localDaemon.status !== "present") return;
    const device = store.create({
      name: "Local",
      link: localDaemon.info.wsUrl,
      token: localDaemon.info.token,
    });
    router.push(`/devices/${device.id}`);
  };

  const banner =
    localDaemon.status === "present" && !matchingDevice ? (
      <div className="rounded-md border border-subtle bg-surface-raised p-3 text-sm text-text">
        <div className="font-medium">Detected local daemon</div>
        <div className="mt-1 font-mono text-xs text-muted">
          {localDaemon.info.wsUrl} &nbsp; cwd={localDaemon.info.cwd}
        </div>
        <button
          type="button"
          onClick={handleAdoptLocalDaemon}
          className="mt-3 rounded-md bg-accent px-3 py-1 text-xs text-bg hover:bg-accent-hover"
        >
          Use this device
        </button>
      </div>
    ) : null;

  if (devices.length === 0) {
    return (
      <div className="space-y-3">
        {banner}
        <div className="rounded-md border border-dashed border-subtle bg-surface-raised px-4 py-6 text-center text-sm text-muted">
          No devices yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {banner}
      <ul className="divide-y divide-subtle rounded-md border border-subtle bg-surface-raised">
        {devices.map((device) => (
          <li key={device.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/settings/devices/${device.id}`}
                className="block truncate text-sm font-medium text-text hover:text-accent hover:underline"
              >
                {device.name}
              </Link>
              <div className="truncate text-xs text-muted font-mono">{device.link}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (typeof window === "undefined") return;
                const ok = window.confirm(`Delete device "${device.name}"?`);
                if (!ok) return;
                store.remove(device.id);
              }}
              className="ml-4 shrink-0 rounded-md border border-status-err px-3 py-1 text-xs text-status-err hover:bg-accent-soft"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
