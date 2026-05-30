import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock next/navigation hooks: jsdom can't run the real Next router. We
// re-export the same hook surface we use (useParams) and let each test
// reset the value via the exposed setter.
let _params: Record<string, string | string[]> = {};
vi.mock("next/navigation", () => ({
  useParams: () => _params,
  usePathname: () => "/",
}));
function setParams(p: Record<string, string | string[]>): void {
  _params = p;
}

import { Sidebar } from "./sidebar";
import {
  __resetConnectionForTests,
  __setConnectionPoolForTests,
} from "../../lib/connection/use-connection";
import { ConnectionPool } from "../../lib/connection/pool";
import { createDevicesStore, type DevicesStore } from "../../lib/store";
import { __resetDevicesStoreForTests } from "../../lib/store/use-devices";

// Stub transport so the pool's first acquire kicks off connect; we won't
// observe completion in these synchronous tests — the sidebar reads from
// the device snapshot we seed by hand.
class IdleTransport {
  closed = false;
  async connect(): Promise<never> {
    return new Promise<never>(() => {
      // never resolves; keeps the entry in `connecting`.
    });
  }
  send(): void {}
  onMessage(): () => void {
    return () => {};
  }
  close(): void {
    this.closed = true;
  }
}

function freshPool(): { pool: ConnectionPool; store: DevicesStore } {
  const pool = new ConnectionPool({
    createTransport: () => new IdleTransport() as unknown as never,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const store = createDevicesStore();
  __setConnectionPoolForTests(pool, store);
  return { pool, store };
}

beforeEach(() => {
  setParams({});
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("Sidebar", () => {
  it("renders empty state when no devices configured", () => {
    freshPool();
    render(<Sidebar />);
    expect(screen.getByText(/No devices configured/)).toBeTruthy();
  });

  it("renders device with `(no projects yet)` placeholder when no snapshot", () => {
    const { store } = freshPool();
    store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    render(<Sidebar />);
    expect(screen.getByText("Tokyo")).toBeTruthy();
    expect(screen.getByText(/no projects yet|not connected|offline/)).toBeTruthy();
  });

  it("renders the full Device > Project > Session tree from a seeded snapshot", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha", sessionCount: 2 },
      { projectSlug: "beta", displayName: "Beta", sessionCount: 0 },
    ]);
    store.setProjectSessions(device.id, "alpha", {
      session_1: { sessionId: "session_1", title: "Hello", updatedAt: 200 },
      session_2: { sessionId: "session_2", title: "World", updatedAt: 100 },
    });
    setParams({ deviceId: device.id, projectSlug: "alpha", sessionId: "session_1" });
    render(<Sidebar />);
    // Device row.
    expect(screen.getByText("Tokyo")).toBeTruthy();
    // Project rows (both rendered).
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    // Session rows under the active project (newest first).
    const sessions = screen.getAllByRole("link", { name: /Hello|World/ });
    expect(sessions[0]?.textContent).toBe("Hello");
    expect(sessions[1]?.textContent).toBe("World");
    // Session link target uses URL encoding.
    expect(sessions[0]?.getAttribute("href")).toContain(
      `/devices/${encodeURIComponent(device.id)}/projects/alpha/sessions/session_1`,
    );
  });

  it("flags an offline tint when device has lastConnectedAt and is not currently connected", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.update(device.id, { lastConnectedAt: 1700000000000 });
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha" },
    ]);
    render(<Sidebar />);
    expect(screen.getByText("offline")).toBeTruthy();
    // Cached project is still rendered.
    expect(screen.getByText("Alpha")).toBeTruthy();
  });
});
