"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useSyncExternalStore } from "react";

import type { Device } from "../../lib/domain/devices";
import { useDevices } from "../../lib/store/use-devices";
import {
  getConnectionPool,
  getDevicesStoreInstance,
} from "../../lib/connection/use-connection";
import { IDLE, type ConnectionState } from "../../lib/connection/state";
import { useCollapsed } from "../../lib/store/use-collapsed";
import { syncSessions } from "../../lib/sync/sessions";
import { CollapseToggle } from "./collapse-toggle";
import { DeviceStatus } from "./device-status";
import { ProjectNode } from "./project-node";

function isOffline(state: ConnectionState): boolean {
  return (
    state.name === "error" ||
    state.name === "disconnected" ||
    state.name === "idle"
  );
}

/**
 * Top fixed action: navigates to `/` and marks itself active when the
 * route is the home route. Visual: rounded surface-hover row, no border.
 */
function NewChatRow({ active }: { active: boolean }): JSX.Element {
  return (
    <Link
      href="/"
      data-testid="new-chat-row"
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-sm px-2 py-2 text-sm font-medium text-text hover:bg-surface-hover ${
        active ? "bg-surface-hover" : ""
      }`}
    >
      <span aria-hidden>+</span>
      <span>新对话</span>
    </Link>
  );
}

/**
 * Codex-semantic placeholder row: visible icon + label, native `disabled`
 * attribute + `.btn-disabled` class composes `opacity 0.4`,
 * `cursor-not-allowed`, and `pointer-events: none`. No tooltip, no hover
 * reaction — silent "not yet" signal.
 */
function DisabledRow({
  icon,
  label,
}: {
  icon: string;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled
      data-testid="disabled-row"
      className="btn-disabled flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-text"
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function SettingsLink(): JSX.Element {
  return (
    <Link
      href="/settings"
      className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted hover:bg-surface-hover hover:text-text"
    >
      <span aria-hidden>⚙</span>
      <span>Settings</span>
    </Link>
  );
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
  const isActiveDevice = activeDeviceId === device.id;
  const activeOnDevice = isActiveDevice && !activeProjectSlug;

  const [collapsed] = useCollapsed(`device:${device.id}`);

  const handleProjectSelect = (
    deviceId: string,
    projectSlug: string,
  ): void => {
    const client = pool.peekClient(deviceId);
    if (!client) return;
    const store = getDevicesStoreInstance();
    void syncSessions({ client, store, deviceId, projectSlug }).catch(() => {
      // The project page itself owns retry UX; sidebar click is best-effort.
    });
  };

  return (
    <li>
      <div className="flex items-center gap-1">
        <CollapseToggle id={`device:${device.id}`} />
        <Link
          href={`/devices/${encodeURIComponent(device.id)}`}
          aria-current={activeOnDevice ? "page" : undefined}
          className={`flex flex-1 items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-hover ${
            activeOnDevice
              ? "bg-surface-hover font-medium text-text"
              : "text-text"
          }`}
        >
          <span className="truncate text-sm">{device.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            {offline && device.lastConnectedAt ? (
              <span
                className="rounded-sm bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint"
                title="Last seen offline"
              >
                offline
              </span>
            ) : null}
            <DeviceStatus state={state} />
          </span>
        </Link>
      </div>
      {!collapsed ? (
        <div
          className={`ml-5 mt-1 ${
            offline && device.lastConnectedAt ? "opacity-60" : ""
          }`}
        >
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
                    isActiveDevice &&
                    activeProjectSlug === project.projectSlug
                  }
                  activeSessionId={
                    isActiveDevice &&
                    activeProjectSlug === project.projectSlug
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
      ) : null}
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
  const pathname = usePathname();
  const activeDeviceId = params?.deviceId
    ? decodeURIComponent(params.deviceId)
    : undefined;
  const activeProjectSlug = params?.projectSlug
    ? decodeURIComponent(params.projectSlug)
    : undefined;
  const activeSessionId = params?.sessionId
    ? decodeURIComponent(params.sessionId)
    : undefined;
  const isHomeRoute = pathname === "/" || pathname === undefined;

  return (
    <aside className="w-[280px] shrink-0 bg-surface flex flex-col">
      {/* Segment 1: top fixed action rows */}
      <div className="px-3 pt-4 pb-2 space-y-1">
        <NewChatRow active={isHomeRoute} />
        <DisabledRow icon="🔍" label="搜索" />
        <DisabledRow icon="🧩" label="插件" />
        <DisabledRow icon="🤖" label="自动化" />
      </div>

      {/* Segment 2: middle device / project tree */}
      <div className="px-3 pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-faint">
        Devices
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 text-sm text-text">
        {devices.length === 0 ? (
          <div className="px-2 py-3 text-sm italic text-muted">
            No devices configured.{" "}
            <Link
              href="/settings"
              className="not-italic text-text underline hover:text-text"
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

      {/* Segment 3: bottom fixed actions */}
      <div className="px-3 py-3 space-y-1">
        <SettingsLink />
        <DisabledRow icon="☀" label="主题" />
      </div>
    </aside>
  );
}
