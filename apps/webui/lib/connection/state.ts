// Connection state machine for the webui Device → DaemonClient binding.
//
// Illegal transitions are NOT thrown. They return the previous state unchanged
// and emit a `console.warn` so the UI never crashes on a stray transport event.
// Tests cover every legal transition + a sample of illegal ones.

export type ConnectionStateName =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type ConnectionErrorReason = "auth" | "network" | "version_mismatch" | "unknown";

export type ConnectionIdentity = {
  deviceId?: string;
  deviceDisplayName?: string;
  projectSlug?: string;
};

export type ConnectionState =
  | { name: "idle" }
  | { name: "connecting" }
  | { name: "connected"; remoteIdentity: ConnectionIdentity }
  | { name: "reconnecting"; attempt: number }
  | { name: "disconnected"; reason?: string }
  | { name: "error"; reason: ConnectionErrorReason; message: string };

export type ConnectionEvent =
  | { type: "connect_start" }
  | { type: "connected"; identity: ConnectionIdentity }
  | { type: "error"; reason: ConnectionErrorReason; message: string }
  | { type: "lost" }
  | { type: "retry_attempt"; n: number }
  | { type: "give_up"; reason: ConnectionErrorReason; message: string }
  | { type: "disconnect_manual" }
  | { type: "disconnect_manual_force"; reason?: string };

export const IDLE: ConnectionState = { name: "idle" };

function warnIllegal(from: ConnectionStateName, eventType: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[scorel/webui] illegal connection transition: ${from} -- ${eventType}`);
}

export function transition(prev: ConnectionState, event: ConnectionEvent): ConnectionState {
  // disconnect_manual_force is a wildcard; legal from any state.
  if (event.type === "disconnect_manual_force") {
    return { name: "disconnected", reason: event.reason };
  }

  switch (prev.name) {
    case "idle": {
      if (event.type === "connect_start") return { name: "connecting" };
      warnIllegal(prev.name, event.type);
      return prev;
    }
    case "connecting": {
      if (event.type === "connected") {
        return { name: "connected", remoteIdentity: { ...event.identity } };
      }
      if (event.type === "error") {
        return { name: "error", reason: event.reason, message: event.message };
      }
      warnIllegal(prev.name, event.type);
      return prev;
    }
    case "connected": {
      if (event.type === "lost") return { name: "reconnecting", attempt: 1 };
      if (event.type === "disconnect_manual") return { name: "idle" };
      warnIllegal(prev.name, event.type);
      return prev;
    }
    case "reconnecting": {
      if (event.type === "retry_attempt") return { name: "connecting" };
      if (event.type === "give_up") {
        return { name: "error", reason: event.reason, message: event.message };
      }
      warnIllegal(prev.name, event.type);
      return prev;
    }
    case "disconnected": {
      if (event.type === "connect_start") return { name: "connecting" };
      warnIllegal(prev.name, event.type);
      return prev;
    }
    case "error": {
      if (event.type === "connect_start") return { name: "connecting" };
      if (event.type === "retry_attempt") return { name: "reconnecting", attempt: event.n };
      warnIllegal(prev.name, event.type);
      return prev;
    }
  }
}
