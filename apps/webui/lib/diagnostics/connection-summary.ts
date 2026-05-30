import type { ConnectionState } from "../connection/state";
import type { SessionAttachSnapshot } from "../connection/session";
import type { Device } from "../domain/devices";

/**
 * Compact, render-ready summary of the live connection + session attach state.
 * Pure data: produced by `buildConnectionSummary`, consumed by the debug panel
 * and any future telemetry surface. No React or DOM access.
 */
export type ConnectionSummary = {
  /** Stable id of the local Device record (the user's webui-side handle). */
  localDeviceId: string;
  /** Daemon-reported `deviceId`, populated after handshake. */
  remoteDeviceId?: string;
  /** Daemon-reported display name, populated after handshake. */
  remoteDeviceDisplayName?: string;
  /** projectSlug of the session being attached, if known. */
  projectSlug?: string;
  /** Session id this attach is bound to. */
  sessionId: string;
  /** Connection state machine name (idle/connecting/connected/...). */
  connectionState: string;
  /** True between turn_start and turn_end on the current session. */
  inFlight: boolean;
  /** True after a user-initiated cancel until the next turn_end. */
  cancelling: boolean;
  /** Highest persistent seq applied so far. */
  persistentLastSeq: number;
  /** Highest stream seq applied so far. */
  streamLastSeq: number;
};

export type ConnectionSummaryInput = {
  device: Pick<Device, "id" | "remoteIdentity">;
  connectionState: ConnectionState;
  snapshot: Pick<
    SessionAttachSnapshot,
    | "inFlight"
    | "cancelling"
    | "persistentLastSeq"
    | "streamLastSeq"
    | "remoteDeviceId"
    | "projectSlug"
    | "sessionId"
  >;
};

/**
 * Build a `ConnectionSummary` from the inputs the page already has on hand.
 * Pure: no side effects, no I/O. Safe to call inside render.
 *
 * Field resolution order for daemon identity:
 * 1. `snapshot.remoteDeviceId` (live from DaemonClient — most authoritative)
 * 2. `device.remoteIdentity.deviceId` (last-known, persisted in DevicesStore)
 */
export function buildConnectionSummary(input: ConnectionSummaryInput): ConnectionSummary {
  const { device, connectionState, snapshot } = input;
  const remoteDeviceId =
    snapshot.remoteDeviceId ?? device.remoteIdentity?.deviceId ?? undefined;
  const remoteDeviceDisplayName = device.remoteIdentity?.deviceDisplayName ?? undefined;
  const projectSlug = snapshot.projectSlug;

  return {
    localDeviceId: device.id,
    ...(remoteDeviceId ? { remoteDeviceId } : {}),
    ...(remoteDeviceDisplayName ? { remoteDeviceDisplayName } : {}),
    ...(projectSlug ? { projectSlug } : {}),
    sessionId: snapshot.sessionId,
    connectionState: connectionState.name,
    inFlight: snapshot.inFlight,
    cancelling: snapshot.cancelling,
    persistentLastSeq: snapshot.persistentLastSeq,
    streamLastSeq: snapshot.streamLastSeq,
  };
}
