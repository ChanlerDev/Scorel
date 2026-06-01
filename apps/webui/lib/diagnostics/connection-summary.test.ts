import { describe, expect, it } from "vitest";

import { buildConnectionSummary } from "./connection-summary";
import { emptyProjectorState } from "../events/projector";
import type { SessionAttachSnapshot } from "../connection/session";

function snap(
  override: Partial<SessionAttachSnapshot> = {},
): SessionAttachSnapshot {
  return {
    loading: false,
    state: emptyProjectorState(),
    inFlight: false,
    cancelling: false,
    persistentLastSeq: 0,
    streamLastSeq: 0,
    sessionId: "session_test",
    ...override,
  };
}

describe("buildConnectionSummary", () => {
  it("collapses device + connection + snapshot into a flat shape", () => {
    const summary = buildConnectionSummary({
      device: {
        id: "local-1",
        remoteIdentity: { deviceId: "remote-1", deviceDisplayName: "Box" },
      },
      connectionState: { name: "connected", remoteIdentity: {} },
      snapshot: snap({
        inFlight: true,
        cancelling: false,
        persistentLastSeq: 5,
        streamLastSeq: 7,
        remoteDeviceId: "remote-live-1",
        projectId: "Users-foo-bar",
        sessionId: "session_test",
      }),
    });

    expect(summary).toEqual({
      localDeviceId: "local-1",
      remoteDeviceId: "remote-live-1",
      remoteDeviceDisplayName: "Box",
      projectId: "Users-foo-bar",
      sessionId: "session_test",
      connectionState: "connected",
      inFlight: true,
      cancelling: false,
      persistentLastSeq: 5,
      streamLastSeq: 7,
    });
  });

  it("falls back to device.remoteIdentity when snapshot lacks remoteDeviceId", () => {
    const summary = buildConnectionSummary({
      device: {
        id: "local-2",
        remoteIdentity: { deviceId: "remote-2" },
      },
      connectionState: { name: "connecting" },
      snapshot: snap({ sessionId: "s" }),
    });
    expect(summary.remoteDeviceId).toBe("remote-2");
    expect(summary.remoteDeviceDisplayName).toBeUndefined();
    expect(summary.connectionState).toBe("connecting");
  });

  it("omits absent identity fields rather than serializing undefined", () => {
    const summary = buildConnectionSummary({
      device: { id: "local-3" },
      connectionState: { name: "idle" },
      snapshot: snap({ sessionId: "s" }),
    });
    expect("remoteDeviceId" in summary).toBe(false);
    expect("remoteDeviceDisplayName" in summary).toBe(false);
    expect("projectId" in summary).toBe(false);
    expect(summary.localDeviceId).toBe("local-3");
    expect(summary.connectionState).toBe("idle");
  });
});
