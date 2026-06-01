import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const _push = vi.fn();
const _replace = vi.fn();
let _searchString = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _push, replace: _replace, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(_searchString),
}));

import { EmptyComposer } from "./empty-composer";
import { ConnectionPool } from "../../lib/connection/pool";
import {
  __resetConnectionForTests,
  __setConnectionPoolForTests,
} from "../../lib/connection/use-connection";
import { createDevicesStore, type DevicesStore } from "../../lib/store";
import { __resetDevicesStoreForTests } from "../../lib/store/use-devices";
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
  _replace.mockReset();
  _searchString = "";
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});

afterEach(() => {
  cleanup();
  __resetConnectionForTests();
  __resetDevicesStoreForTests();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  vi.restoreAllMocks();
});

describe("EmptyComposer", () => {
  it("renders the no-devices CTA when there are no devices configured", () => {
    freshPool();
    render(<EmptyComposer />);
    expect(screen.getByTestId("empty-composer-no-devices")).toBeTruthy();
    expect(screen.getByText("欢迎使用 Scorel")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Settings/ });
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("renders H1, Composer and picker row when devices exist", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha", displayName: "Alpha" },
      { projectId: "beta", displayName: "Beta" },
    ]);
    render(<EmptyComposer />);
    expect(
      screen.getByText("我们应该在 Alpha 中构建什么?"),
    ).toBeTruthy();
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("随心输入");
    expect(screen.getByTestId("empty-composer-picker")).toBeTruthy();
    const select = screen.getByTestId(
      "empty-composer-project-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("alpha");
    // Mode + branch placeholders are present and disabled.
    const mode = screen.getByTestId(
      "empty-composer-mode",
    ) as HTMLButtonElement;
    const branch = screen.getByTestId(
      "empty-composer-branch",
    ) as HTMLButtonElement;
    expect(mode.disabled).toBe(true);
    expect(mode.className).toContain("btn-disabled");
    expect(branch.disabled).toBe(true);
    expect(branch.className).toContain("btn-disabled");
  });

  it("URL ?project= overrides localStorage and route prop", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha" },
      { projectId: "beta" },
      { projectId: "gamma" },
    ]);
    window.localStorage.setItem(
      "scorel.ui.v2.last-active-project",
      JSON.stringify({ [device.id]: "beta" }),
    );
    _searchString = `device=${encodeURIComponent(device.id)}&project=gamma`;
    render(<EmptyComposer routeProjectId="alpha" />);
    const select = screen.getByTestId(
      "empty-composer-project-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("gamma");
  });

  it("falls back to localStorage when URL has no project query", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha" },
      { projectId: "beta" },
    ]);
    window.localStorage.setItem(
      "scorel.ui.v2.last-active-project",
      JSON.stringify({ [device.id]: "beta" }),
    );
    render(<EmptyComposer />);
    const select = screen.getByTestId(
      "empty-composer-project-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("beta");
  });

  it("falls back to first project when localStorage points at unknown slug", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha" },
      { projectId: "beta" },
    ]);
    window.localStorage.setItem(
      "scorel.ui.v2.last-active-project",
      JSON.stringify({ [device.id]: "ghost" }),
    );
    render(<EmptyComposer />);
    const select = screen.getByTestId(
      "empty-composer-project-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("alpha");
  });

  it("changing the project select calls router.replace and writes localStorage", async () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "alpha" },
      { projectId: "beta" },
    ]);
    render(<EmptyComposer />);
    const select = screen.getByTestId(
      "empty-composer-project-select",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "beta" } });
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(_replace).toHaveBeenCalledTimes(1);
    const arg = _replace.mock.calls[0]?.[0] as string;
    expect(arg.startsWith("/?")).toBe(true);
    expect(arg).toContain(`device=${encodeURIComponent(device.id)}`);
    expect(arg).toContain("project=beta");
    const persisted = JSON.parse(
      window.localStorage.getItem("scorel.ui.v2.last-active-project") ?? "{}",
    ) as Record<string, string>;
    expect(persisted[device.id]).toBe("alpha");
  });

  it("disables the project select when the device has only one project", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    render(<EmptyComposer />);
    const select = screen.getByTestId(
      "empty-composer-project-select",
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it("Send disabled when picker has no project (zero-project device)", () => {
    const { store } = freshPool();
    store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    render(<EmptyComposer />);
    // No projects → no slug → composer Send remains disabled because the
    // wrapper passes `disabled={!projectId}` to <Composer>.
    const input = screen.getByTestId(
      "composer-input",
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });

  it("handleSend creates a session, stashes prompt, and routes", async () => {
    const { store, pool } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    pool.acquire(device);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    const stub = vi
      .fn<typeof import("../../lib/sync/session-create").createSessionForProject>()
      .mockResolvedValue({ sessionId: "session_new" });

    render(<EmptyComposer createSession={stub} />);
    const input = screen.getByTestId(
      "composer-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello world" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(stub).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: device.id,
        projectId: "alpha",
      }),
    );
    expect(
      window.sessionStorage.getItem("scorel.pending-prompt:session_new"),
    ).toBe("hello world");
    expect(_push).toHaveBeenCalledWith(
      `/devices/${encodeURIComponent(device.id)}/projects/alpha/sessions/session_new`,
    );
  });

  it("handleSend surfaces banner and skips sessionStorage on failure", async () => {
    const { store, pool } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    pool.acquire(device);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    const stub = vi
      .fn<typeof import("../../lib/sync/session-create").createSessionForProject>()
      .mockRejectedValue(new Error("server boom"));

    render(<EmptyComposer createSession={stub} />);
    const input = screen.getByTestId(
      "composer-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "fail me" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(_push).not.toHaveBeenCalled();
    expect(screen.getByTestId("composer-error").textContent).toBe(
      "server boom",
    );
    // No pending-prompt key written because the create failed.
    let pendingFound = false;
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith("scorel.pending-prompt:")) pendingFound = true;
    }
    expect(pendingFound).toBe(false);
  });

  it("handleSend shows banner when the device is not connected", async () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "alpha" }]);
    // Intentionally skip pool.acquire so peekClient returns null.

    const stub = vi
      .fn<typeof import("../../lib/sync/session-create").createSessionForProject>()
      .mockResolvedValue({ sessionId: "session_new" });

    render(<EmptyComposer createSession={stub} />);
    const input = screen.getByTestId(
      "composer-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(stub).not.toHaveBeenCalled();
    expect(_push).not.toHaveBeenCalled();
    expect(screen.getByTestId("composer-error").textContent).toContain(
      "设备未连接",
    );
  });

  // S0047: dynamic H1 — picks `displayName ?? projectId`, falls back to a
  // brand-neutral question when no project resolves.
  it("S0047 H1 uses project displayName when present", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [
      { projectId: "scorel", displayName: "Scorel" },
    ]);
    render(<EmptyComposer />);
    const heading = screen.getByTestId("empty-composer-greeting");
    expect(heading.textContent).toBe("我们应该在 Scorel 中构建什么?");
  });

  it("S0047 H1 falls back to projectId when displayName is missing", () => {
    const { store } = freshPool();
    const device = store.create({
      name: "Tokyo",
      link: "wss://h",
      token: "t",
    });
    store.setProjects(device.id, [{ projectId: "raw-slug" }]);
    render(<EmptyComposer />);
    const heading = screen.getByTestId("empty-composer-greeting");
    expect(heading.textContent).toBe("我们应该在 raw-slug 中构建什么?");
  });

  it("S0047 H1 falls back to brand-neutral question when no project resolves", () => {
    const { store } = freshPool();
    // Device exists but has no projects → projectId remains undefined and
    // the H1 should drop the project clause entirely.
    store.create({ name: "Tokyo", link: "wss://h", token: "t" });
    render(<EmptyComposer />);
    const heading = screen.getByTestId("empty-composer-greeting");
    expect(heading.textContent).toBe("我们应该构建什么?");
  });
});
