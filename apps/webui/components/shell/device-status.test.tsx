import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DeviceStatus } from "./device-status";
import type { ConnectionState } from "../../lib/connection/state";

afterEach(() => cleanup());

function dot(): HTMLElement {
  const el = screen.getByRole("status");
  return el;
}

describe("DeviceStatus", () => {
  it("renders idle state", () => {
    render(<DeviceStatus state={{ name: "idle" }} />);
    const el = dot();
    expect(el.dataset.state).toBe("idle");
    expect(el.getAttribute("aria-label")).toBe("Idle");
    expect(el.title).toBe("Idle");
    expect(el.querySelector(".bg-status-idle")).toBeTruthy();
  });

  it("renders connecting state with warn dot", () => {
    render(<DeviceStatus state={{ name: "connecting" }} />);
    const el = dot();
    expect(el.dataset.state).toBe("connecting");
    expect(el.getAttribute("aria-label")).toBe("Connecting…");
    expect(el.querySelector(".bg-status-warn")).toBeTruthy();
  });

  it("renders reconnecting attempt count", () => {
    render(<DeviceStatus state={{ name: "reconnecting", attempt: 3 }} />);
    const el = dot();
    expect(el.getAttribute("aria-label")).toBe("Reconnecting attempt 3");
    expect(el.querySelector(".bg-status-warn")).toBeTruthy();
  });

  it("renders connected state with display name", () => {
    const state: ConnectionState = {
      name: "connected",
      remoteIdentity: { deviceId: "device_a", deviceDisplayName: "Tokyo" },
    };
    render(<DeviceStatus state={state} />);
    const el = dot();
    expect(el.getAttribute("aria-label")).toBe("Connected as Tokyo");
    expect(el.querySelector(".bg-status-ok")).toBeTruthy();
  });

  it("falls back to deviceId when displayName is missing", () => {
    const state: ConnectionState = {
      name: "connected",
      remoteIdentity: { deviceId: "device_a" },
    };
    render(<DeviceStatus state={state} />);
    expect(dot().getAttribute("aria-label")).toBe("Connected as device_a");
  });

  it("renders disconnected state", () => {
    render(<DeviceStatus state={{ name: "disconnected" }} />);
    const el = dot();
    expect(el.getAttribute("aria-label")).toBe("Disconnected");
    expect(el.querySelector(".bg-status-idle")).toBeTruthy();
  });

  it("renders error state with reason and message", () => {
    render(<DeviceStatus state={{ name: "error", reason: "auth", message: "Token rejected" }} />);
    const el = dot();
    expect(el.getAttribute("aria-label")).toBe("auth: Token rejected");
    expect(el.querySelector(".bg-status-err")).toBeTruthy();
  });
});
