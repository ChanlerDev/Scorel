"use client";

import type { ConnectionState } from "../../lib/connection/state";

const DOT_CLASSES: Record<ConnectionState["name"], string> = {
  idle: "bg-status-idle",
  connecting: "bg-status-warn",
  reconnecting: "bg-status-warn",
  connected: "bg-status-ok",
  disconnected: "bg-status-idle",
  error: "bg-status-err",
};

function tooltipFor(state: ConnectionState): string {
  switch (state.name) {
    case "idle":
      return "Idle";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return `Reconnecting attempt ${state.attempt}`;
    case "connected": {
      const name =
        state.remoteIdentity.deviceDisplayName ??
        state.remoteIdentity.deviceId ??
        "remote";
      return `Connected as ${name}`;
    }
    case "disconnected":
      return state.reason ? `Disconnected: ${state.reason}` : "Disconnected";
    case "error":
      return `${state.reason}: ${state.message}`;
  }
}

export type DeviceStatusProps = {
  state: ConnectionState;
  className?: string;
};

export function DeviceStatus({ state, className }: DeviceStatusProps): JSX.Element {
  const dot = DOT_CLASSES[state.name];
  const tooltip = tooltipFor(state);
  return (
    <span
      role="status"
      aria-label={tooltip}
      title={tooltip}
      data-state={state.name}
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
    </span>
  );
}
