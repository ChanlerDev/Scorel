import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const _push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _push, replace: vi.fn(), back: vi.fn() }),
}));

import { NewChatButton } from "./new-chat-button";
import { ConnectionPool } from "../../lib/connection/pool";
import {
  __resetConnectionForTests,
  __setConnectionPoolForTests,
} from "../../lib/connection/use-connection";
import { createDevicesStore, type DevicesStore } from "../../lib/store";
import { __resetDevicesStoreForTests } from "../../lib/store/use-devices";
import type { DaemonClient } from "@scorel/client";
import type {
  ClientMessage,
  ConnectParams,
  ConnectResult,
  DaemonMessage,
  DaemonTransport,
  Unsubscribe,
} from "@scorel/protocol";
import { asClientId, asDeviceId, asSeq } from "@scorel/protocol";

class ImmediateTransport implements DaemonTransport {
  closed = false;
  #handlers = new Set<(message: DaemonMessage) => void>();

  async connect(_params: ConnectParams): Promise<ConnectResult> {
    return {
      clientId: asClientId("client_a"),
      currentSeq: asSeq(0),
      deviceId: asDeviceId("device_a"),
      deviceDisplayName: "Tokyo",
    };
  }
  send(_message: ClientMessage): void {}
  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }
  close(): void {
    this.closed = true;
    this.#handlers.clear();
  }
}

function freshPool(): { pool: ConnectionPool; store: DevicesStore } {
  const pool = new ConnectionPool({
    createTransport: () => new ImmediateTransport(),
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const store = createDevicesStore();
  __setConnectionPoolForTests(pool, store);
  return { pool, store };
}

beforeEach(() => {
  _push.mockReset();
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("NewChatButton", () => {
  it("is disabled with tooltip when no project context", () => {
    render(
      <NewChatButton
        deviceId={undefined}
        projectSlug={undefined}
        variant="sidebar"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("title")).toBe("Select a project first");
  });

  it("is enabled when project route is active", () => {
    render(
      <NewChatButton deviceId="dev1" projectSlug="alpha" variant="sidebar" />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("shows error banner when device is not connected (no client in pool)", async () => {
    freshPool();
    render(
      <NewChatButton deviceId="missing" projectSlug="alpha" variant="page" />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Connect to the device first",
    );
    expect(_push).not.toHaveBeenCalled();
  });

  it("invokes the creator + router.push on success", async () => {
    const { store, pool } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    pool.acquire(device);
    // Wait for pool's connect promise to resolve.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    const stub = vi
      .fn<typeof import("../../lib/sync/session-create").createSessionForProject>()
      .mockResolvedValue({ sessionId: "session_new" });

    render(
      <NewChatButton
        deviceId={device.id}
        projectSlug="alpha"
        variant="page"
        createSession={stub}
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(stub).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: device.id,
        projectSlug: "alpha",
      }),
    );
    expect(_push).toHaveBeenCalledWith(
      `/devices/${encodeURIComponent(device.id)}/projects/alpha/sessions/session_new`,
    );
  });

  it("shows banner and does not navigate on createSession failure", async () => {
    const { store, pool } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    pool.acquire(device);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    const stub = vi
      .fn<typeof import("../../lib/sync/session-create").createSessionForProject>()
      .mockRejectedValue(new Error("server boom"));

    render(
      <NewChatButton
        deviceId={device.id}
        projectSlug="alpha"
        variant="page"
        createSession={stub}
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toBe("server boom");
    expect(_push).not.toHaveBeenCalled();
  });
});
