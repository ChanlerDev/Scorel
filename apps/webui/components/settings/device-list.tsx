"use client";

import Link from "next/link";
import { useDevices } from "../../lib/store/use-devices";

export function DeviceList() {
  const { devices, store } = useDevices();

  if (devices.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-500">
        No devices yet.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
      {devices.map((device) => (
        <li key={device.id} className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <Link
              href={`/settings/devices/${device.id}`}
              className="block truncate text-sm font-medium text-zinc-900 hover:underline"
            >
              {device.name}
            </Link>
            <div className="truncate text-xs text-zinc-500 font-mono">{device.link}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (typeof window === "undefined") return;
              const ok = window.confirm(`Delete device "${device.name}"?`);
              if (!ok) return;
              store.remove(device.id);
            }}
            className="ml-4 shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
