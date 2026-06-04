import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ClientMessage,
  ConnectParams,
  ConnectResult,
  DaemonMessage,
  DaemonTransport,
  Unsubscribe,
} from "@scorel/protocol";
import { asClientId, asDeviceId, asSeq } from "@scorel/protocol";

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

const syncProjectsMock = vi.fn();
let _dialogResult: {
  deviceId: string;
  client: {
    listProjects: ReturnType<typeof vi.fn>;
    registerProject: ReturnType<typeof vi.fn>;
    listDirectories: ReturnType<typeof vi.fn>;
    removeProject: ReturnType<typeof vi.fn>;
  };
  project: {
    projectId: string;
    displayName: string;
    workDir: string;
    createdAt: number;
    updatedAt: number;
  };
} | null = null;

vi.mock("../../lib/sync/projects", async () => {
  const actual = await vi.importActual<typeof import("../../lib/sync/projects")>(
    "../../lib/sync/projects",
  );
  return {
    ...actual,
    syncProjects: (...args: Parameters<typeof actual.syncProjects>) =>
      syncProjectsMock(...args),
  };
});

vi.mock("./add-project-dialog", () => ({
  AddProjectDialog: (props: {
    open: boolean;
    devices: Array<{ name: string }>;
    onClose(): void;
    onRegistered(input: NonNullable<typeof _dialogResult>): Promise<void>;
  }) => {
    if (!props.open) return null;
    return (
      <div data-testid="add-project-dialog-mock">
        <div data-testid="add-project-dialog-device-count">
          {props.devices.length}
        </div>
        <button
          type="button"
          onClick={() => {
            if (_dialogResult) {
              void props.onRegistered(_dialogResult);
            }
          }}
        >
          完成添加项目
        </button>
        <button type="button" onClick={props.onClose}>
          关闭对话框
        </button>
      </div>
    );
  },
}));

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

class ImmediateTransport implements DaemonTransport {
  closed = false;
  #handlers = new Set<(message: DaemonMessage) => void>();

  async connect(_params: ConnectParams): Promise<ConnectResult> {
    return {
      clientId: asClientId("client_sidebar"),
      currentSeq: asSeq(0),
      deviceId: asDeviceId("device_sidebar"),
      deviceDisplayName: "Tokyo Remote",
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

class ErrorTransport implements DaemonTransport {
  closed = false;
  #handlers = new Set<(message: DaemonMessage) => void>();

  async connect(): Promise<ConnectResult> {
    throw new Error("auth_failed");
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
    createTransport: () => new IdleTransport() as unknown as never,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const store = createDevicesStore();
  __setConnectionPoolForTests(pool, store);
  return { pool, store };
}

function freshConnectedPool(): { pool: ConnectionPool; store: DevicesStore } {
  const pool = new ConnectionPool({
    createTransport: () => new ImmediateTransport(),
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const store = createDevicesStore();
  __setConnectionPoolForTests(pool, store);
  return { pool, store };
}

function freshErrorPool(): { pool: ConnectionPool; store: DevicesStore } {
  const pool = new ConnectionPool({
    createTransport: () => new ErrorTransport(),
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
  syncProjectsMock.mockReset();
  _dialogResult = null;
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
    expect(screen.getByTestId("add-project-button")).toBeTruthy();
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
      { projectId: "alpha", displayName: "Alpha", sessionCount: 2 },
      { projectId: "beta", displayName: "Beta", sessionCount: 0 },
    ]);
    store.setProjectSessions(device.id, "alpha", {
      session_1: { sessionId: "session_1", title: "Hello", updatedAt: 200 },
      session_2: { sessionId: "session_2", title: "World", updatedAt: 100 },
    });
    setParams({
      deviceId: device.id,
      projectId: "alpha",
      sessionId: "session_1",
    });
    render(<Sidebar />);
    expect(screen.getByText("Tokyo")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    const sessionLinks = screen
      .getAllByRole("link")
      .filter((el) => el.textContent?.includes("Hello") || el.textContent?.includes("World"));
    expect(sessionLinks).toHaveLength(2);
    const helloLink = sessionLinks.find((el) => el.textContent?.includes("Hello"));
    expect(helloLink?.getAttribute("href")).toContain(
      `/devices/${encodeURIComponent(device.id)}/projects/alpha/sessions/session_1`,
    );
  });

  it("device row is a button (not a link) and toggles project visibility", () => {
    const { store } = freshPool();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    store.setProjects(device.id, [
      { projectId: "alpha", displayName: "Alpha" },
    ]);
    render(<Sidebar />);

    const deviceButton = screen.getByRole("button", { name: /Tokyo/ });
    expect(deviceButton.tagName).toBe("BUTTON");
    expect(screen.queryByRole("link", { name: /Tokyo/ })).toBeNull();

    // Initial: device expanded, project visible.
    expect(screen.getByText("Alpha")).toBeTruthy();

    // Click device button to collapse.
    fireEvent.click(deviceButton);
    expect(screen.queryByText("Alpha")).toBeNull();

    // Click again to expand.
    fireEvent.click(deviceButton);
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("clicking a project row toggles session visibility without navigation", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha", displayName: "Alpha", sessionCount: 1 },
    ]);
    store.setProjectSessions(device.id, "alpha", {
      session_1: { sessionId: "session_1", title: "Hello", updatedAt: 200 },
    });
    setParams({ deviceId: device.id, projectId: "alpha" });

    const { unmount } = render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Hello/ })).toBeTruthy();

    // Click project button — no router push, just collapse.
    const projectButton = screen.getByRole("button", { name: /^Alpha/ });
    expect(projectButton.tagName).toBe("BUTTON");
    fireEvent.click(projectButton);
    expect(_push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Hello/ })).toBeNull();

    // localStorage write happened.
    const persisted = JSON.parse(
      window.localStorage.getItem("scorel.ui.collapsed") ?? "{}",
    ) as Record<string, boolean>;
    expect(persisted[`project:${device.id}/alpha`]).toBe(true);

    // Remount: collapse state survives.
    unmount();
    __resetCollapsedForTests();
    render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Hello/ })).toBeNull();
  });

  it("flags an offline tint when reconnect fails and the device has lastConnectedAt", async () => {
    const { store } = freshErrorPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.update(device.id, { lastConnectedAt: 1700000000000 });
    store.setProjects(device.id, [
      { projectId: "alpha", displayName: "Alpha" },
    ]);
    render(<Sidebar />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("offline")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("auto-connects devices after mount so refresh does not leave them idle", async () => {
    const { store } = freshConnectedPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    syncProjectsMock.mockResolvedValue([]);

    render(<Sidebar />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(syncProjectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: device.id }),
    );
    expect(screen.getByRole("status", { name: /Connected as Tokyo Remote/ })).toBeTruthy();
  });

  it("does not render a top-of-bottom-segment divider (S0045 single card)", () => {
    freshPool();
    const { container } = render(<Sidebar />);
    // The previous implementation had `border-t border-subtle p-3` on the
    // bottom segment. S0045 collapses the sidebar into one card; verify no
    // descendant of `<aside>` carries `border-t`.
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    const offenders = aside?.querySelectorAll(".border-t, .border-r");
    expect(offenders?.length ?? 0).toBe(0);
  });

  it("opens the add project dialog from the sidebar action", () => {
    freshPool();
    render(<Sidebar />);

    fireEvent.click(screen.getByTestId("add-project-button"));
    expect(screen.getByTestId("add-project-dialog-mock")).toBeTruthy();
  });

  it("opens the add project dialog from the shared shell event", () => {
    freshPool();
    render(<Sidebar />);

    act(() => {
      window.dispatchEvent(new Event("scorel:add-project"));
    });

    expect(screen.getByTestId("add-project-dialog-mock")).toBeTruthy();
  });

  it("syncs projects after registration and navigates to the project route", async () => {
    const { store } = freshPool();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    const client = {
      listProjects: vi.fn(),
      listDirectories: vi.fn(),
      registerProject: vi.fn(),
      removeProject: vi.fn(),
    };
    _dialogResult = {
      deviceId: device.id,
      client,
      project: {
        projectId: "new-project",
        displayName: "New Project",
        workDir: "/repo/new-project",
        createdAt: 1,
        updatedAt: 1,
      },
    };
    syncProjectsMock.mockImplementation(async ({ store, deviceId }) => {
      store.setProjects(deviceId, [
        { projectId: "new-project", displayName: "New Project" },
        { projectId: "shared-project", displayName: "Shared Project" },
      ]);
      return [];
    });

    render(<Sidebar />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-project-button"));
    });
    const completeButton = await screen.findByRole("button", {
      name: "完成添加项目",
    });
    await act(async () => {
      fireEvent.click(completeButton);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(syncProjectsMock).toHaveBeenCalledTimes(1);
    expect(syncProjectsMock.mock.calls[0]?.[0]).toMatchObject({
      client,
      deviceId: device.id,
    });
    expect(client.removeProject).not.toHaveBeenCalled();
    expect(screen.getByText("New Project")).toBeTruthy();
    expect(screen.getByText("Shared Project")).toBeTruthy();
    expect(_push).toHaveBeenCalledWith(
      `/devices/${encodeURIComponent(device.id)}/projects/new-project`,
    );
  });

  it("does not append a project locally before syncProjects resolves", async () => {
    const { store } = freshPool();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    store.setProjects(device.id, [{ projectId: "cached", displayName: "Cached" }]);
    const client = {
      listProjects: vi.fn(),
      listDirectories: vi.fn(),
      registerProject: vi.fn(),
      removeProject: vi.fn(),
    };
    _dialogResult = {
      deviceId: device.id,
      client,
      project: {
        projectId: "new-project",
        displayName: "New Project",
        workDir: "/repo/new-project",
        createdAt: 1,
        updatedAt: 1,
      },
    };

    let resolveSync!: () => void;
    syncProjectsMock.mockImplementation(
      ({ store, deviceId }: { store: DevicesStore; deviceId: string }) =>
        new Promise((resolve) => {
          resolveSync = () => {
            store.setProjects(deviceId, [
              { projectId: "cached", displayName: "Cached" },
              { projectId: "new-project", displayName: "New Project" },
            ]);
            resolve([]);
          };
        }),
    );

    render(<Sidebar />);

    fireEvent.click(screen.getByTestId("add-project-button"));
    const completeButton = await screen.findByRole("button", {
      name: "完成添加项目",
    });
    fireEvent.click(completeButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(store.get(device.id)?.projects?.map((project) => project.projectId)).toEqual([
      "cached",
    ]);
    expect(screen.queryByText("New Project")).toBeNull();

    await act(async () => {
      resolveSync();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(store.get(device.id)?.projects?.map((project) => project.projectId)).toEqual([
      "cached",
      "new-project",
    ]);
  });

  it("expands a collapsed device and new project after successful registration", async () => {
    const { store } = freshPool();
    const device = store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "scorel.ui.collapsed",
        JSON.stringify({
          [`device:${device.id}`]: true,
          [`project:${device.id}/new-project`]: true,
        }),
      );
    }
    const client = {
      listProjects: vi.fn(),
      listDirectories: vi.fn(),
      registerProject: vi.fn(),
      removeProject: vi.fn(),
    };
    _dialogResult = {
      deviceId: device.id,
      client,
      project: {
        projectId: "new-project",
        displayName: "New Project",
        workDir: "/repo/new-project",
        createdAt: 1,
        updatedAt: 1,
      },
    };
    syncProjectsMock.mockImplementation(async ({ store, deviceId }) => {
      store.setProjects(deviceId, [
        { projectId: "new-project", displayName: "New Project" },
      ]);
      return [];
    });

    render(<Sidebar />);
    expect(screen.queryByText("New Project")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-project-button"));
    });
    const completeButton = await screen.findByRole("button", {
      name: "完成添加项目",
    });
    await act(async () => {
      fireEvent.click(completeButton);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(screen.getByText("New Project")).toBeTruthy();
  });
});
