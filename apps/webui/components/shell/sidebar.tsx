"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import type { Device } from "../../lib/domain/devices";
import { useDevices } from "../../lib/store/use-devices";
import { getConnectionPool } from "../../lib/connection/use-connection";
import { IDLE, type ConnectionState } from "../../lib/connection/state";
import { DeviceStatus } from "./device-status";

function DeviceRow({ device }: { device: Device }): JSX.Element {
  const pool = getConnectionPool();
  const state = useSyncExternalStore<ConnectionState>(
    (listener) => pool.subscribe(device.id, listener),
    () => pool.state(device.id),
    () => IDLE,
  );

  return (
    <li>
      <Link
        href={`/devices/${device.id}`}
        className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-zinc-100"
      >
        <span className="truncate font-medium text-zinc-800">{device.name}</span>
        <DeviceStatus state={state} className="shrink-0" />
      </Link>
    </li>
  );
}

export function Sidebar() {
  const { devices } = useDevices();

  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-200 bg-white flex flex-col">
      <div className="p-3 space-y-2">
        <button
          type="button"
          disabled
          className="w-full text-left rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 cursor-not-allowed"
        >
          + New Chat
        </button>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400">
          Search…
        </div>
      </div>

      <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-zinc-500">
        Projects
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 text-sm text-zinc-600">
        {devices.length === 0 ? (
          <div className="px-2 py-3 italic text-zinc-500">
            No devices configured.{" "}
            <Link href="/settings" className="not-italic text-zinc-700 underline hover:text-zinc-900">
              Add a device in Settings
            </Link>
          </div>
        ) : (
          <ul className="space-y-1">
            {devices.map((device) => (
              <DeviceRow key={device.id} device={device} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-zinc-200 p-3">
        <Link
          href="/settings"
          className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          ⚙ Settings
        </Link>
      </div>
    </aside>
  );
}
