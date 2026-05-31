import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const _push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/",
}));

import ProjectPage from "./page";
import { ConnectionPool } from "../../../../../lib/connection/pool";
import {
  __resetConnectionForTests,
  __setConnectionPoolForTests,
} from "../../../../../lib/connection/use-connection";
import {
  createDevicesStore,
  type DevicesStore,
} from "../../../../../lib/store";
import { __resetDevicesStoreForTests } from "../../../../../lib/store/use-devices";
import type { Device } from "../../../../../lib/domain/devices";
import type {
  ClientMessage,
  ConnectParams,
  ConnectResult,
  DaemonMessage,
  DaemonTransport,
  SessionSummary,
  Unsubscribe,
} from "@scorel/protocol";
import { asClientId, asDeviceId, asSeq, asSessionId } from "@scorel/protocol";

let listSessionsImpl: () => Promise<SessionSummary[]> = async () => [];
let listSessionsCalls = 0;
let listProjectsImpl: () => Promise<unknown[]> = async () => [];
let createSessionImpl: () => Promise<{ sessionId: string }> = async () => ({
  sessionId: "session_new",
});
let createSessionCalls = 0;
let createSessionLastMeta:
  | { projectSlug?: string; title?: string; model?: string }
  | undefined;

class FakeTransport implements DaemonTransport {
  closed = false;
  #handlers = new Set<(message: DaemonMessage) => void>();

  constructor(_url: string, _token: string) {}

  async connect(_params: ConnectParams): Promise<ConnectResult> {
    return {
      clientId: asClientId("client_x"),
      currentSeq: asSeq(0),
      deviceId: asDeviceId("device_remote"),
      deviceDisplayName: "Tokyo Remote",
    };
  }

  send(message: ClientMessage): void {
    if ((message as { type: string }).type === "list_sessions") {
      listSessionsCalls += 1;
      const requestId = (message as { requestId: string }).requestId;
      void listSessionsImpl().then(
        (sessions) => {
          const response: DaemonMessage = {
            type: "response",
            requestId: requestId as never,
            data: { sessions },
          } as unknown as DaemonMessage;
          for (const h of this.#handlers) h(response);
        },
        (err: Error) => {
          const response: DaemonMessage = {
            type: "error",
            requestId: requestId as never,
            message: err.message,
            errorCode: "internal_error",
          } as unknown as DaemonMessage;
          for (const h of this.#handlers) h(response);
        },
      );
    }
    if ((message as { type: string }).type === "list_projects") {
      const requestId = (message as { requestId: string }).requestId;
      void listProjectsImpl().then((projects) => {
        const response: DaemonMessage = {
          type: "response",
          requestId: requestId as never,
          data: { projects },
        } as unknown as DaemonMessage;
        for (const h of this.#handlers) h(response);
      });
    }
    if ((message as { type: string }).type === "create_session") {
      createSessionCalls += 1;
      const m = message as {
        requestId: string;
        meta?: { projectSlug?: string; title?: string; model?: string };
      };
      createSessionLastMeta = m.meta;
      const requestId = m.requestId;
      void createSessionImpl().then(
        ({ sessionId }) => {
          const response: DaemonMessage = {
            type: "response",
            requestId: requestId as never,
            data: { sessionId },
          } as unknown as DaemonMessage;
          for (const h of this.#handlers) h(response);
        },
        (err: Error) => {
          const response: DaemonMessage = {
            type: "error",
            requestId: requestId as never,
            message: err.message,
            errorCode: "internal_error",
          } as unknown as DaemonMessage;
          for (const h of this.#handlers) h(response);
        },
      );
    }
  }

  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.#handlers.clear();
  }
}

class FakeClock {
  #handle = 0;
  readonly tasks = new Map<number, { cb: () => void; ms: number }>();

  set = (cb: () => void, ms: number): unknown => {
    this.#handle += 1;
    this.tasks.set(this.#handle, { cb, ms });
    return this.#handle;
  };
  clear = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };
}

function seedDevice(): { device: Device; store: DevicesStore } {
  const store = createDevicesStore();
  const device = store.create({
    name: "Tokyo VPS",
    link: "wss://tokyo.example",
    token: "tok",
  });
  return { device, store };
}

function installPool(store: DevicesStore): ConnectionPool {
  const clock = new FakeClock();
  const pool = new ConnectionPool({
    createTransport: (link, token) => new FakeTransport(link, token),
    setTimeoutFn: clock.set,
    clearTimeoutFn: clock.clear,
  });
  __setConnectionPoolForTests(pool, store);
  return pool;
}

beforeEach(() => {
  _push.mockReset();
  listSessionsCalls = 0;
  listSessionsImpl = async () => [];
  listProjectsImpl = async () => [
    {
      projectSlug: "alpha",
      displayName: "Alpha",
      sessionCount: 0,
      lastSeenAt: 0,
    },
  ];
  createSessionCalls = 0;
  createSessionLastMeta = undefined;
  createSessionImpl = async () => ({ sessionId: "session_new" });
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

describe("ProjectPage", () => {
  it("renders 'Device not found' when no matching device", () => {
    render(
      <ProjectPage
        params={{ deviceId: "missing", projectSlug: "alpha" }}
      />,
    );
    expect(screen.getByText(/Device not found/)).toBeTruthy();
  });

  it("renders cached sessions immediately while triggering a refresh", async () => {
    const { device, store } = seedDevice();
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha" },
    ]);
    store.setProjectSessions(device.id, "alpha", {
      cached: { sessionId: "cached", title: "Cached Session", updatedAt: 1 },
    });
    listSessionsImpl = async () => [
      {
        sessionId: asSessionId("fresh"),
        title: "Fresh Session",
        updatedAt: 2,
        currentSeq: asSeq(1),
        projectSlug: "alpha",
      },
    ];
    installPool(store);

    render(
      <ProjectPage params={{ deviceId: device.id, projectSlug: "alpha" }} />,
    );
    // Cached session visible right away.
    expect(screen.getByText("Cached Session")).toBeTruthy();
    // Wait for the connect promise + the list_sessions request to flush.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(listSessionsCalls).toBe(1);
    expect(screen.getByText("Fresh Session")).toBeTruthy();
  });

  it("renders an empty-state message when project has no sessions", async () => {
    const { device, store } = seedDevice();
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha" },
    ]);
    listSessionsImpl = async () => [];
    installPool(store);

    render(
      <ProjectPage params={{ deviceId: device.id, projectSlug: "alpha" }} />,
    );
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(screen.getByText(/No sessions yet/)).toBeTruthy();
  });

  it("renders an error banner on listSessions failure with retry button", async () => {
    const { device, store } = seedDevice();
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha" },
    ]);
    listSessionsImpl = async () => {
      throw new Error("boom");
    };
    installPool(store);

    render(
      <ProjectPage params={{ deviceId: device.id, projectSlug: "alpha" }} />,
    );
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(screen.getByText(/Failed to load sessions/)).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("New Chat navigates to the empty composer carrying device + project (S0046)", async () => {
    const { device, store } = seedDevice();
    store.setProjects(device.id, [
      { projectSlug: "alpha", displayName: "Alpha" },
    ]);
    installPool(store);

    render(
      <ProjectPage params={{ deviceId: device.id, projectSlug: "alpha" }} />,
    );
    // Wait for connect + initial sync to settle.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    const btn = screen.getByRole("button", { name: /New Chat/ });
    // S0046: button is always enabled — empty composer handles missing
    // context gracefully on the landing.
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    // Crucially: clicking New Chat must NOT mint a session. Lazy creation
    // happens only on the empty composer's first send.
    expect(createSessionCalls).toBe(0);
    const target = _push.mock.calls[0]?.[0] as string;
    expect(target.startsWith("/?")).toBe(true);
    expect(target).toContain(`device=${encodeURIComponent(device.id)}`);
    expect(target).toContain("project=alpha");
    // Cache must be untouched.
    const project = store
      .get(device.id)
      ?.projects?.find((p) => p.projectSlug === "alpha");
    expect(project?.sessions?.session_new).toBeUndefined();
  });
});
