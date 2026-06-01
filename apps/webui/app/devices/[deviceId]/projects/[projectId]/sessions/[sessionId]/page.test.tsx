import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
} from "@testing-library/react";

const _push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(""),
}));

// Mock the session attach controller so we can drive `loading=false` and
// observe `controller.send` calls deterministically without standing up a
// full transport.
type MockSnapshot = {
  loading: boolean;
  state: { turns: unknown[] };
  inFlight: boolean;
  cancelling: boolean;
  persistentLastSeq: number;
  streamLastSeq: number;
  sessionId: string;
};

let onStateCb: ((next: MockSnapshot) => void) | null = null;
const sendMock = vi.fn(async (_content: string): Promise<void> => {});
const stopMock = vi.fn(() => {});
const startMock = vi.fn(async (): Promise<void> => {});

function emit(loading: boolean): void {
  if (!onStateCb) return;
  onStateCb({
    loading,
    state: { turns: [] },
    inFlight: false,
    cancelling: false,
    persistentLastSeq: 0,
    streamLastSeq: 0,
    sessionId: "session_target",
  });
}

vi.mock("../../../../../../../lib/connection/session", () => ({
  createSessionAttachController: (opts: {
    onState: (snap: MockSnapshot) => void;
  }) => {
    onStateCb = opts.onState;
    // Mirror real-life: emit a `loading=true` snapshot before start() resolves
    // so the page renders the loading state initially.
    queueMicrotask(() => emit(true));
    return {
      start: startMock,
      stop: stopMock,
      send: sendMock,
      cancel: async () => {},
    };
  },
}));

vi.mock("../../../../../../../lib/identity/scope-key", () => ({
  computeScopeKey: async (deviceId: string, projectId: string) =>
    `${deviceId}/${projectId}`,
}));

import SessionPage from "./page";
import { ConnectionPool } from "../../../../../../../lib/connection/pool";
import {
  __resetConnectionForTests,
  __setConnectionPoolForTests,
} from "../../../../../../../lib/connection/use-connection";
import {
  createDevicesStore,
  type DevicesStore,
} from "../../../../../../../lib/store";
import { __resetDevicesStoreForTests } from "../../../../../../../lib/store/use-devices";
import type {
  ClientMessage,
  ConnectParams,
  ConnectResult,
  DaemonMessage,
  DaemonTransport,
  Unsubscribe,
} from "@scorel/protocol";
import { asClientId, asDeviceId, asSeq } from "@scorel/protocol";
import type { Device } from "../../../../../../../lib/domain/devices";

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

function seedDevice(): { device: Device; store: DevicesStore } {
  const store = createDevicesStore();
  const device = store.create({
    name: "Tokyo VPS",
    link: "wss://tokyo.example",
    token: "tok",
  });
  store.setProjects(device.id, [
    { projectId: "alpha", displayName: "Alpha" },
  ]);
  store.setProjectSessions(device.id, "alpha", {
    session_target: {
      sessionId: "session_target",
      title: "Cached",
      updatedAt: 1,
    },
  });
  return { device, store };
}

function installPool(store: DevicesStore): ConnectionPool {
  const pool = new ConnectionPool({
    createTransport: (link, token) => new FakeTransport(link, token),
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  __setConnectionPoolForTests(pool, store);
  return pool;
}

beforeEach(() => {
  _push.mockReset();
  sendMock.mockClear();
  startMock.mockClear();
  stopMock.mockClear();
  onStateCb = null;
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

describe("SessionPage pending-prompt consumption (S0046)", () => {
  it("drains scorel.pending-prompt:<id> exactly once after loading clears", async () => {
    const { device, store } = seedDevice();
    installPool(store);
    window.sessionStorage.setItem(
      "scorel.pending-prompt:session_target",
      "hello pending",
    );

    render(
      <SessionPage
        params={{
          deviceId: device.id,
          projectId: "alpha",
          sessionId: "session_target",
        }}
      />,
    );
    // Let the connect promise + the controller's microtask flush.
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    // While loading=true, send must NOT be called.
    expect(sendMock).not.toHaveBeenCalled();

    // Flip loading to false (simulates initial resync settling).
    await act(async () => {
      emit(false);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("hello pending");
    expect(
      window.sessionStorage.getItem("scorel.pending-prompt:session_target"),
    ).toBeNull();

    // Re-emit loading=false a second time; the one-shot guard prevents
    // a duplicate send.
    await act(async () => {
      emit(false);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no pending prompt for this session", async () => {
    const { device, store } = seedDevice();
    installPool(store);

    render(
      <SessionPage
        params={{
          deviceId: device.id,
          projectId: "alpha",
          sessionId: "session_target",
        }}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      emit(false);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not consume a pending prompt for a different session id", async () => {
    const { device, store } = seedDevice();
    installPool(store);
    window.sessionStorage.setItem(
      "scorel.pending-prompt:session_other",
      "wrong target",
    );

    render(
      <SessionPage
        params={{
          deviceId: device.id,
          projectId: "alpha",
          sessionId: "session_target",
        }}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      emit(false);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(sendMock).not.toHaveBeenCalled();
    // Untargeted entry remains intact.
    expect(
      window.sessionStorage.getItem("scorel.pending-prompt:session_other"),
    ).toBe("wrong target");
  });
});
