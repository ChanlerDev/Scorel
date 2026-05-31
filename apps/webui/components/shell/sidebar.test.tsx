import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Mock next/navigation hooks: jsdom can't run the real Next router. We
// re-export the hook surface we use (useParams + usePathname + useRouter)
// and let each test reset the value via the exposed setters.
let _params: Record<string, string | string[]> = {};
let _pathname = "/";
const _push = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => _params,
  usePathname: () => _pathname,
  useRouter: () => ({ push: _push, replace: vi.fn(), back: vi.fn() }),
}));
function setParams(p: Record<string, string | string[]>): void {
  _params = p;
}
function setPathname(p: string): void {
  _pathname = p;
}

import { Sidebar } from "./sidebar";
import {
  __resetConnectionForTests,
  __setConnectionPoolForTests,
} from "../../lib/connection/use-connection";
import { ConnectionPool } from "../../lib/connection/pool";
import { createDevicesStore, type DevicesStore } from "../../lib/store";
import { __resetDevicesStoreForTests } from "../../lib/store/use-devices";
import { __resetCollapsedForTests } from "../../lib/store/use-collapsed";

class IdleTransport {
  closed = false;
  async connect(): Promise<never> {
    return new Promise<never>(() => {});
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
  setPathname("/");
  _push.mockReset();
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") window.localStorage.clear();
  __resetCollapsedForTests();
});

afterEach(() => {
  cleanup();
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") window.localStorage.clear();
  __resetCollapsedForTests();
});

describe("Sidebar", () => {
  it("renders the three segments: top actions / Devices group / bottom actions", () => {
    freshPool();
    render(<Sidebar />);
    // Top: New Chat + 3 disabled placeholders.
    expect(screen.getByTestId("new-chat-row")).toBeTruthy();
    const disabled = screen.getAllByTestId("disabled-row");
    // Top has 3 disabled (search/plugins/automation), bottom has 1 (theme).
    expect(disabled.length).toBe(4);
    for (const el of disabled) {
      expect(el.hasAttribute("disabled")).toBe(true);
      expect(el.className).toContain("btn-disabled");
    }
    // Middle group label.
    expect(screen.getByText("Devices")).toBeTruthy();
    // Empty state.
    expect(screen.getByText(/No devices configured/)).toBeTruthy();
    // Bottom Settings link (the empty-state body has another link to
    // /settings, so match by exact text + href).
    const settingsLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href") === "/settings");
    expect(settingsLinks.length).toBeGreaterThanOrEqual(1);
    expect(
      settingsLinks.some((el) => el.textContent?.includes("Settings")),
    ).toBe(true);
  });

  it("New Chat row is active on the home route", () => {
    freshPool();
    setPathname("/");
    render(<Sidebar />);
    const row = screen.getByTestId("new-chat-row");
    expect(row.getAttribute("aria-current")).toBe("page");
  });

  it("New Chat row is not active on a non-home route", () => {
    freshPool();
    setPathname("/settings");
    render(<Sidebar />);
    const row = screen.getByTestId("new-chat-row");
    expect(row.getAttribute("aria-current")).toBeNull();
  });

  it("renders device with `(no projects yet)` placeholder when no snapshot", () => {
    const { store } = freshPool();
    store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    render(<Sidebar />);
    expect(screen.getByText("Tokyo")).toBeTruthy();
    expect(
      screen.getByText(/no projects yet|not connected|offline/),
    ).toBeTruthy();
  });

  it("renders the Device > Project > Session tree from a seeded snapshot", () => {
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
    setParams({
      deviceId: device.id,
      projectSlug: "alpha",
      sessionId: "session_1",
    });
    render(<Sidebar />);
    expect(screen.getByText("Tokyo")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    const sessions = screen.getAllByRole("link", { name: /Hello|World/ });
    expect(sessions[0]?.textContent).toBe("Hello");
    expect(sessions[1]?.textContent).toBe("World");
    expect(sessions[0]?.getAttribute("href")).toContain(
      `/devices/${encodeURIComponent(device.id)}/projects/alpha/sessions/session_1`,
    );
  });

  it("collapsing a project hides its sessions and persists across remount", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha", sessionCount: 1 },
    ]);
    store.setProjectSessions(device.id, "alpha", {
      session_1: { sessionId: "session_1", title: "Hello", updatedAt: 200 },
    });
    setParams({ deviceId: device.id, projectSlug: "alpha" });

    const { unmount } = render(<Sidebar />);
    // Project session is visible.
    expect(screen.getByRole("link", { name: "Hello" })).toBeTruthy();

    // Click the collapse toggle on the project row. Two toggles exist —
    // one for the device, one for the project. The project toggle is the
    // second (rendered after the device row's toggle).
    const toggles = screen.getAllByTestId("collapse-toggle");
    const projectToggle = toggles.find(
      (el) => el.getAttribute("aria-label") === "Collapse" && el !== toggles[0],
    );
    expect(projectToggle).toBeTruthy();
    fireEvent.click(projectToggle as HTMLElement);

    // Session row should now be hidden.
    expect(screen.queryByRole("link", { name: "Hello" })).toBeNull();

    // localStorage write happened.
    const persisted = JSON.parse(
      window.localStorage.getItem("scorel.ui.collapsed") ?? "{}",
    ) as Record<string, boolean>;
    expect(persisted[`project:${device.id}/alpha`]).toBe(true);

    // Remount: collapse state survives.
    unmount();
    __resetCollapsedForTests();
    render(<Sidebar />);
    expect(screen.queryByRole("link", { name: "Hello" })).toBeNull();
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
    expect(screen.getByText("Alpha")).toBeTruthy();
  });
});
