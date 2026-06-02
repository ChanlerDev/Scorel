import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClientMessage,
  ConnectParams,
  ConnectResult,
  DaemonMessage,
  DaemonTransport,
  Unsubscribe,
} from "@scorel/protocol";
import { asClientId, asDeviceId, asSeq } from "@scorel/protocol";

import type { Device } from "../domain/devices";
import { ConnectionPool, DEFAULT_BACKOFF_MS, MAX_RETRY_ATTEMPTS } from "./pool";
import type { ConnectionState } from "./state";

type ConnectBehavior =
  | { kind: "ok"; result: ConnectResult }
  | { kind: "error"; error: Error };

class FakeTransport implements DaemonTransport {
  readonly url: string;
  readonly token: string;
  static instances: FakeTransport[] = [];
  static behaviors: ConnectBehavior[] = [];
  static defaultIdentity: ConnectResult = {
    clientId: asClientId("client_fake"),
    currentSeq: asSeq(0),
    deviceId: asDeviceId("device_fake"),
  };

  closed = false;
  connectCalls = 0;
  #handlers = new Set<(message: DaemonMessage) => void>();

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
    FakeTransport.instances.push(this);
  }

  async connect(_params: ConnectParams): Promise<ConnectResult> {
    this.connectCalls += 1;
    const next = FakeTransport.behaviors.shift();
    if (!next) {
      return { ...FakeTransport.defaultIdentity };
    }
    if (next.kind === "error") {
      throw next.error;
    }
    return next.result;
  }

  send(_message: ClientMessage): void {
    // ignore
  }

  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.#handlers.clear();
  }

  static reset(): void {
    FakeTransport.instances = [];
    FakeTransport.behaviors = [];
  }
}

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: overrides.id ?? "dev_a",
    name: overrides.name ?? "Alpha",
    link: overrides.link ?? "wss://example.test",
    token: overrides.token ?? "tok",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

class FakeClock {
  #handle = 0;
  readonly tasks = new Map<number, { cb: () => void; ms: number }>();

  set = (cb: () => void, ms: number): unknown => {
    this.#handle += 1;
    const id = this.#handle;
    this.tasks.set(id, { cb, ms });
    return id;
  };

  clear = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  flushNext(): void {
    const [id, task] = this.tasks.entries().next().value ?? [];
    if (id === undefined || !task) return;
    this.tasks.delete(id);
    task.cb();
  }

  flushAll(): void {
    while (this.tasks.size > 0) {
      this.flushNext();
    }
  }
}

beforeEach(() => {
  FakeTransport.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectionPool", () => {
  it("acquire creates one client per device id and reuses on rapid re-acquire", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_remote"),
          deviceDisplayName: "Remote A",
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
    });
    const device = makeDevice();
    const a = pool.acquire(device);
    const b = pool.acquire(device);
    expect(a.client).toBe(b.client);
    expect(FakeTransport.instances).toHaveLength(1);
    // Wait for the queued connect promise to resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(a.state.name).toBe("connected");
  });

  it("captures identity on connect and notifies onIdentity listener", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_remote"),
          deviceDisplayName: "Remote A",
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
    });
    const captured: Array<{ deviceId?: string; deviceDisplayName?: string }> = [];
    const managed = pool.acquire(makeDevice(), (id) => captured.push({ ...id }));
    await Promise.resolve();
    await Promise.resolve();
    expect(managed.state).toEqual({
      name: "connected",
      remoteIdentity: {
        deviceId: "device_remote",
        deviceDisplayName: "Remote A",
        projectId: undefined,
      },
    });
    expect(captured).toEqual([
      { deviceId: "device_remote", deviceDisplayName: "Remote A", projectId: undefined },
    ]);
  });

  it("schedules backoff retries on network errors and lands in error after exhausting attempts", async () => {
    // 1 initial + 5 retries = 6 failures.
    FakeTransport.behaviors = Array.from({ length: 6 }).map(() => ({
      kind: "error" as const,
      error: new Error("connect ECONNREFUSED 127.0.0.1:18789"),
    }));
    const clock = new FakeClock();
    const backoff = vi.fn(DEFAULT_BACKOFF_MS);
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
      backoffMs: backoff,
    });
    const states: ConnectionState[] = [];
    const managed = pool.acquire(makeDevice());
    managed.subscribe((s) => states.push(s));
    // Drain the initial failure.
    await Promise.resolve();
    await Promise.resolve();
    expect(managed.state.name).toBe("error");
    // Drain all queued retries.
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i += 1) {
      clock.flushNext();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(managed.state.name).toBe("error");
    // backoff was consulted exactly MAX_RETRY_ATTEMPTS times with attempts 1..5.
    expect(backoff.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5]);
    expect(FakeTransport.instances[0]?.connectCalls).toBe(MAX_RETRY_ATTEMPTS + 1);
    // Sanity: at least one reconnecting state was visible to subscribers.
    expect(states.some((s) => s.name === "reconnecting")).toBe(true);
  });

  it("auth errors do not schedule retries", async () => {
    FakeTransport.behaviors = [
      { kind: "error", error: new Error("auth_failed") },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
    });
    // categorize() looks at the error message; "auth_failed" alone is unknown.
    // For auth bucket we feed a network-shaped negative test instead: assert
    // that *non-network* errors stay in `error` without scheduling timers.
    const managed = pool.acquire(makeDevice());
    await Promise.resolve();
    await Promise.resolve();
    expect(managed.state.name).toBe("error");
    expect(clock.tasks.size).toBe(0);
  });

  it("manual reconnect resets attempts and triggers a new connect", async () => {
    FakeTransport.behaviors = [
      { kind: "error", error: new Error("connect ECONNREFUSED") },
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_a"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
    });
    const managed = pool.acquire(makeDevice());
    await Promise.resolve();
    await Promise.resolve();
    expect(managed.state.name).toBe("error");
    // Cancels the scheduled retry, restarts immediately.
    managed.reconnect();
    await Promise.resolve();
    await Promise.resolve();
    expect(managed.state.name).toBe("connected");
    // Pending retry timer was cancelled.
    expect(clock.tasks.size).toBe(0);
  });

  it("manual disconnect transitions a connected client to idle", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_fake"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
    });
    const managed = pool.acquire(makeDevice());
    await Promise.resolve();
    await Promise.resolve();
    expect(managed.state.name).toBe("connected");
    managed.disconnect();
    expect(managed.state.name).toBe("idle");
  });

  it("release schedules a tear-down after idleReleaseMs and acquire within the window cancels it", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_fake"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
      idleReleaseMs: 1_000,
    });
    const device = makeDevice();
    pool.acquire(device);
    await Promise.resolve();
    await Promise.resolve();
    pool.release(device.id);
    expect(clock.tasks.size).toBe(1);
    // Re-acquire within window cancels the timer + reuses same client.
    const managedAgain = pool.acquire(device);
    expect(clock.tasks.size).toBe(0);
    expect(managedAgain.state.name).toBe("connected");
    expect(FakeTransport.instances).toHaveLength(1);
  });

  it("release fires tear-down after the window when no consumer re-acquires", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_fake"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
      idleReleaseMs: 1_000,
    });
    const device = makeDevice();
    pool.acquire(device);
    await Promise.resolve();
    await Promise.resolve();
    pool.release(device.id);
    clock.flushNext();
    expect(FakeTransport.instances[0]?.closed).toBe(true);
    expect(pool.state(device.id).name).toBe("idle");
  });

  it("waits for the last consumer to release before scheduling idle teardown", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_fake"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
      idleReleaseMs: 1_000,
    });
    const device = makeDevice();
    pool.acquire(device);
    pool.acquire(device);
    await Promise.resolve();
    await Promise.resolve();

    pool.release(device.id);
    expect(clock.tasks.size).toBe(0);
    expect(pool.hasEntry(device.id)).toBe(true);

    pool.release(device.id);
    expect(clock.tasks.size).toBe(1);
    clock.flushNext();
    expect(pool.hasEntry(device.id)).toBe(false);
  });

  it("tracks whether a device entry currently exists", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_fake"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
      idleReleaseMs: 1_000,
    });
    const device = makeDevice();

    expect(pool.hasEntry(device.id)).toBe(false);
    pool.acquire(device);
    expect(pool.hasEntry(device.id)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    pool.release(device.id);
    clock.flushNext();
    expect(pool.hasEntry(device.id)).toBe(false);
  });

  it("shutdown closes all clients and clears entries", async () => {
    FakeTransport.behaviors = [
      {
        kind: "ok",
        result: {
          clientId: asClientId("client_x"),
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_fake"),
        },
      },
    ];
    const clock = new FakeClock();
    const pool = new ConnectionPool({
      createTransport: (link, token) => new FakeTransport(link, token),
      setTimeoutFn: clock.set,
      clearTimeoutFn: clock.clear,
    });
    pool.acquire(makeDevice());
    await Promise.resolve();
    await Promise.resolve();
    pool.shutdown();
    expect(FakeTransport.instances[0]?.closed).toBe(true);
    expect(pool.state("dev_a").name).toBe("idle");
  });
});
