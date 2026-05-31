"use client";

import Link from "next/link";
import { useDevices } from "../../lib/store/use-devices";

export function DeviceList() {
  const { devices, store } = useDevices();

  if (devices.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-subtle bg-surface-raised px-4 py-6 text-center text-sm text-muted">
        No devices yet.
      </div>
    );
  }

  return (
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
  );
}
