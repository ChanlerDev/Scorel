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
import { NewChatButton } from "./new-chat-button";
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
  const activeOnDevice = isActiveDevice && !activeProjectSlug;

  return (
    <li>
      <Link
        href={`/devices/${encodeURIComponent(device.id)}`}
        aria-current={activeOnDevice ? "page" : undefined}
        className={`flex items-center justify-between gap-2 rounded-md border-l-2 px-2 py-1.5 hover:bg-accent-soft ${
          activeOnDevice
            ? "border-accent bg-accent-soft text-accent"
            : "border-transparent"
        }`}
      >
        <span className="truncate text-sm font-medium">{device.name}</span>
        <span className="flex items-center gap-1 shrink-0">
          {offline && device.lastConnectedAt ? (
            <span
              className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint"
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
          <p className="px-2 py-1 text-xs italic text-faint">
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
    <aside className="w-[280px] shrink-0 border-r border-subtle bg-surface flex flex-col">
      <div className="p-3 space-y-2">
        <NewChatButton
          deviceId={activeDeviceId}
          projectSlug={activeProjectSlug}
          variant="sidebar"
        />
        <div className="rounded-md border border-subtle bg-surface-raised px-3 py-2 text-sm text-faint">
          Search…
        </div>
      </div>

      <div className="px-3 pt-2 pb-1 font-display text-sm text-muted">
        Projects
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 text-sm text-text">
        {devices.length === 0 ? (
          <div className="px-2 py-3 text-sm italic text-muted">
            No devices configured.{" "}
            <Link
              href="/settings"
              className="not-italic text-accent underline hover:text-accent-hover"
            >
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

      <div className="border-t border-subtle p-3">
        <Link
          href="/settings"
          className="block rounded-md px-3 py-1.5 text-sm text-muted hover:bg-accent-soft hover:text-accent"
        >
          ⚙ Settings
        </Link>
      </div>
    </aside>
  );
}
