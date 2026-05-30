"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSyncExternalStore } from "react";

import type { Device } from "../../lib/domain/devices";
import { useDevices } from "../../lib/store/use-devices";
import {
  getConnectionPool,
  getDevicesStoreInstance,
} from "../../lib/connection/use-connection";
import { IDLE, type ConnectionState } from "../../lib/connection/state";
import { syncSessions } from "../../lib/sync/sessions";
import { DeviceStatus } from "./device-status";
import { ProjectNode } from "./project-node";

function isOffline(state: ConnectionState): boolean {
  return state.name === "error" || state.name === "disconnected" || state.name === "idle";
}

function DeviceTree({
  device,
  activeDeviceId,
  activeProjectSlug,
  activeSessionId,
}: {
  device: Device;
  activeDeviceId?: string;
  activeProjectSlug?: string;
  activeSessionId?: string;
}): JSX.Element {
  const pool = getConnectionPool();
  const state = useSyncExternalStore<ConnectionState>(
    (listener) => pool.subscribe(device.id, listener),
    () => pool.state(device.id),
    () => IDLE,
  );

  const projects = device.projects ?? [];
  const offline = isOffline(state);

  const handleProjectSelect = (deviceId: string, projectSlug: string): void => {
    const client = pool.peekClient(deviceId);
    if (!client) return;
    const store = getDevicesStoreInstance();
    void syncSessions({ client, store, deviceId, projectSlug }).catch(() => {
      // The project page itself owns retry UX; sidebar click is best-effort.
    });
  };

  const isActiveDevice = activeDeviceId === device.id;

  return (
    <li>
      <Link
        href={`/devices/${encodeURIComponent(device.id)}`}
        aria-current={isActiveDevice && !activeProjectSlug ? "page" : undefined}
        className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-zinc-100 ${
          isActiveDevice && !activeProjectSlug ? "bg-zinc-100" : ""
        }`}
      >
        <span className="truncate font-medium text-zinc-800">{device.name}</span>
        <span className="flex items-center gap-1 shrink-0">
          {offline && device.lastConnectedAt ? (
            <span
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500"
              title="Last seen offline"
            >
              offline
            </span>
          ) : null}
          <DeviceStatus state={state} />
        </span>
      </Link>
      <div className={`ml-2 mt-1 ${offline && device.lastConnectedAt ? "opacity-60" : ""}`}>
        {projects.length === 0 ? (
          <p className="px-2 py-1 text-xs italic text-zinc-500">
            {state.name === "connected"
              ? "(no projects yet)"
              : device.lastConnectedAt
              ? "(offline; no cached projects)"
              : "(not connected)"}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {projects.map((project) => (
              <ProjectNode
                key={project.projectSlug}
                deviceId={device.id}
                project={project}
                isActive={
                  isActiveDevice && activeProjectSlug === project.projectSlug
                }
                activeSessionId={
                  isActiveDevice && activeProjectSlug === project.projectSlug
                    ? activeSessionId
                    : undefined
                }
                offline={offline}
                onSelect={handleProjectSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function Sidebar() {
  const { devices } = useDevices();
  const params = useParams<{
    deviceId?: string;
    projectSlug?: string;
    sessionId?: string;
  }>();
  const activeDeviceId = params?.deviceId
    ? decodeURIComponent(params.deviceId)
    : undefined;
  const activeProjectSlug = params?.projectSlug
    ? decodeURIComponent(params.projectSlug)
    : undefined;
  const activeSessionId = params?.sessionId
    ? decodeURIComponent(params.sessionId)
    : undefined;

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
          <ul className="space-y-2">
            {devices.map((device) => (
              <DeviceTree
                key={device.id}
                device={device}
                activeDeviceId={activeDeviceId}
                activeProjectSlug={activeProjectSlug}
                activeSessionId={activeSessionId}
              />
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
