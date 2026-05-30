import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDLE,
  type ConnectionState,
  transition,
} from "./state";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connection state machine", () => {
  it("idle -> connecting on connect_start", () => {
    expect(transition(IDLE, { type: "connect_start" })).toEqual({ name: "connecting" });
  });

  it("connecting -> connected captures identity (defensive copy)", () => {
    const identity = { deviceId: "device_a", deviceDisplayName: "A" };
    const next = transition({ name: "connecting" }, { type: "connected", identity });
    expect(next).toEqual({
      name: "connected",
      remoteIdentity: { deviceId: "device_a", deviceDisplayName: "A" },
    });
    // Mutating the original identity object must not retroactively mutate state.
    identity.deviceId = "mutated";
    expect((next as Extract<ConnectionState, { name: "connected" }>).remoteIdentity.deviceId).toBe("device_a");
  });

  it("connecting -> error on error event", () => {
    expect(
      transition({ name: "connecting" }, { type: "error", reason: "auth", message: "Token rejected" }),
    ).toEqual({ name: "error", reason: "auth", message: "Token rejected" });
  });

  it("connected -> reconnecting on lost (attempt 1)", () => {
    const prev: ConnectionState = { name: "connected", remoteIdentity: {} };
    expect(transition(prev, { type: "lost" })).toEqual({ name: "reconnecting", attempt: 1 });
  });

  it("reconnecting -> connecting on retry_attempt", () => {
    expect(
      transition({ name: "reconnecting", attempt: 1 }, { type: "retry_attempt", n: 3 }),
    ).toEqual({ name: "connecting" });
  });

  it("reconnecting -> error on give_up", () => {
    expect(
      transition(
        { name: "reconnecting", attempt: 5 },
        { type: "give_up", reason: "network", message: "exhausted" },
      ),
    ).toEqual({ name: "error", reason: "network", message: "exhausted" });
  });

  it("connected -> idle on disconnect_manual", () => {
    expect(
      transition({ name: "connected", remoteIdentity: {} }, { type: "disconnect_manual" }),
    ).toEqual({ name: "idle" });
  });

  it("error -> connecting on connect_start", () => {
    expect(
      transition(
        { name: "error", reason: "network", message: "unreachable" },
        { type: "connect_start" },
      ),
    ).toEqual({ name: "connecting" });
  });

  it("error -> reconnecting on retry_attempt (pool-driven backoff)", () => {
    expect(
      transition(
        { name: "error", reason: "network", message: "unreachable" },
        { type: "retry_attempt", n: 2 },
      ),
    ).toEqual({ name: "reconnecting", attempt: 2 });
  });

  it("disconnected -> connecting on connect_start", () => {
    expect(
      transition({ name: "disconnected" }, { type: "connect_start" }),
    ).toEqual({ name: "connecting" });
  });

  it("disconnect_manual_force forces disconnected from any state", () => {
    const cases: ConnectionState[] = [
      { name: "idle" },
      { name: "connecting" },
      { name: "connected", remoteIdentity: {} },
      { name: "reconnecting", attempt: 2 },
      { name: "error", reason: "auth", message: "x" },
    ];
    for (const c of cases) {
      expect(
        transition(c, { type: "disconnect_manual_force", reason: "shutdown" }),
      ).toEqual({ name: "disconnected", reason: "shutdown" });
    }
  });

  describe("illegal transitions return prev with console.warn", () => {
    it("idle does not accept `connected` event", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = transition(IDLE, { type: "connected", identity: {} });
      expect(result).toBe(IDLE);
      expect(warn).toHaveBeenCalledOnce();
    });

    it("connected does not accept `connect_start`", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const prev: ConnectionState = { name: "connected", remoteIdentity: {} };
      const result = transition(prev, { type: "connect_start" });
      expect(result).toBe(prev);
      expect(warn).toHaveBeenCalledOnce();
    });

    it("error does not accept `lost`", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const prev: ConnectionState = { name: "error", reason: "unknown", message: "x" };
      const result = transition(prev, { type: "lost" });
      expect(result).toBe(prev);
      expect(warn).toHaveBeenCalledOnce();
    });

    it("disconnected does not accept `connected`", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const prev: ConnectionState = { name: "disconnected" };
      const result = transition(prev, { type: "connected", identity: {} });
      expect(result).toBe(prev);
      expect(warn).toHaveBeenCalledOnce();
    });
  });
});
