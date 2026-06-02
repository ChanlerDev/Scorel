// ConnectionPool: owns one DaemonClient per Device.id, exposes a managed
// ConnectionState stream per device, and wraps lifecycle (connect, retry,
// release, manual reconnect / disconnect).
//
// Scope per S0035:
// - Initial daemon-only handshake: client.connect() (no session).
// - On success, persist captured identity into the Device store via the
//   `onIdentity` callback supplied to acquire().
// - On failure, categorize the error and either schedule a retry (network
//   reasons) or stay in `error` (auth / version_mismatch / unknown).
// - Manual reconnect / disconnect via ManagedConnection.
// - Idle release: when the last route consumer of a device releases it, the
//   underlying ws connection is torn down after `idleReleaseMs` (default 60s).
//
// Out of scope (S0036+): list_projects, list_sessions, session attach.

import { DaemonClient, WsTransport } from "@scorel/client";
import type { DaemonTransport } from "@scorel/protocol";
import { asClientId } from "@scorel/protocol";

import type { Device } from "../domain/devices";
import { categorize } from "./error";
import {
  IDLE,
  type ConnectionEvent,
  type ConnectionIdentity,
  type ConnectionState,
  transition,
} from "./state";

export type IdentityListener = (identity: ConnectionIdentity) => void;

export type ManagedConnection = {
  readonly deviceId: string;
  readonly client: DaemonClient;
  readonly state: ConnectionState;
  connect(): Promise<void>;
  reconnect(): void;
  disconnect(): void;
  subscribe(listener: (state: ConnectionState) => void): () => void;
};

export type ConnectionPoolOptions = {
  createTransport?: (link: string, token: string) => DaemonTransport;
  backoffMs?: (attempt: number) => number;
  idleReleaseMs?: number;
  /** Test seam for deterministic clientIds. */
  createClientId?: (deviceId: string) => string;
  /** Test seam for `setTimeout` to simulate timers. Defaults to globalThis.setTimeout. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
};

// 1s, 2s, 4s, 8s, 30s — five retries, then terminal `error` until user clicks Reconnect.
export const DEFAULT_BACKOFF_MS = (attempt: number): number => {
  switch (attempt) {
    case 1:
      return 1_000;
    case 2:
      return 2_000;
    case 3:
      return 4_000;
    case 4:
      return 8_000;
    default:
      return 30_000;
  }
};
export const MAX_RETRY_ATTEMPTS = 5;
export const DEFAULT_IDLE_RELEASE_MS = 60_000;

type Entry = {
  device: Device;
  client: DaemonClient;
  state: ConnectionState;
  refCount: number;
  retryAttempt: number;
  retryHandle?: unknown;
  idleHandle?: unknown;
  listeners: Set<(state: ConnectionState) => void>;
  identityListeners: Set<IdentityListener>;
  // Outstanding `connect()` promise to deduplicate concurrent acquires.
  pending?: Promise<void>;
};

function nextId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

export class ConnectionPool {
  readonly #entries = new Map<string, Entry>();
  readonly #createTransport: (link: string, token: string) => DaemonTransport;
  readonly #backoffMs: (attempt: number) => number;
  readonly #idleReleaseMs: number;
  readonly #createClientId: (deviceId: string) => string;
  readonly #setTimeout: (cb: () => void, ms: number) => unknown;
  readonly #clearTimeout: (handle: unknown) => void;
  #shutdown = false;

  constructor(opts: ConnectionPoolOptions = {}) {
    this.#createTransport =
      opts.createTransport ??
      ((link, token) => new WsTransport({ url: link, token }) as DaemonTransport);
    this.#backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.#idleReleaseMs = opts.idleReleaseMs ?? DEFAULT_IDLE_RELEASE_MS;
    this.#createClientId = opts.createClientId ?? ((_deviceId) => nextId("webui"));
    this.#setTimeout =
      opts.setTimeoutFn ??
      ((cb, ms) => globalThis.setTimeout(cb, ms) as unknown);
    this.#clearTimeout =
      opts.clearTimeoutFn ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  acquire(device: Device, onIdentity?: IdentityListener): ManagedConnection {
    if (this.#shutdown) {
      throw new Error("ConnectionPool: shutdown");
    }
    let entry = this.#entries.get(device.id);
    if (entry && this.#isReusable(entry)) {
      // Cancel any pending idle release: a fresh consumer has shown up.
      if (entry.idleHandle !== undefined) {
        this.#clearTimeout(entry.idleHandle);
        entry.idleHandle = undefined;
      }
      entry.refCount += 1;
      // Refresh device snapshot (link/token may have changed via Settings).
      entry.device = device;
      if (onIdentity) entry.identityListeners.add(onIdentity);
      return this.#asManaged(entry);
    }

    if (entry) {
      // Tear down stale entry before creating a fresh one.
      this.#tearDown(entry);
      this.#entries.delete(device.id);
    }

    entry = this.#createEntry(device);
    entry.refCount = 1;
    this.#entries.set(device.id, entry);
    if (onIdentity) entry.identityListeners.add(onIdentity);
    // Kick off the connect. Any errors propagate to subscribers via state.
    void this.#connect(entry).catch(() => {
      /* state already reflects the error */
    });
    return this.#asManaged(entry);
  }

  release(deviceId: string): void {
    const entry = this.#entries.get(deviceId);
    if (!entry) return;
    if (entry.refCount > 0) {
      entry.refCount -= 1;
    }
    if (entry.refCount > 0) {
      return;
    }
    if (entry.idleHandle !== undefined) {
      this.#clearTimeout(entry.idleHandle);
    }
    entry.idleHandle = this.#setTimeout(() => {
      const current = this.#entries.get(deviceId);
      if (!current) return;
      this.#tearDown(current);
      this.#entries.delete(deviceId);
    }, this.#idleReleaseMs);
  }

  subscribe(deviceId: string, listener: (state: ConnectionState) => void): () => void {
    const entry = this.#entries.get(deviceId);
    if (!entry) {
      // Unknown device; emit a single idle snapshot and return noop.
      listener(IDLE);
      return () => {};
    }
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  state(deviceId: string): ConnectionState {
    return this.#entries.get(deviceId)?.state ?? IDLE;
  }

  hasEntry(deviceId: string): boolean {
    return this.#entries.has(deviceId);
  }

  /**
   * Return the active DaemonClient for a device IF the pool already holds an
   * entry. Returns `null` when no entry exists (caller would have to call
   * `acquire()` first). Used by the sidebar to fire `syncSessions` on a
   * project click without taking out a fresh acquire reference.
   */
  peekClient(deviceId: string): DaemonClient | null {
    const entry = this.#entries.get(deviceId);
    if (!entry) return null;
    if (entry.state.name !== "connected") return null;
    return entry.client;
  }

  shutdown(): void {
    this.#shutdown = true;
    for (const entry of this.#entries.values()) {
      this.#tearDown(entry);
    }
    this.#entries.clear();
  }

  // --- internals ---------------------------------------------------------

  #createEntry(device: Device): Entry {
    const transport = this.#createTransport(device.link, device.token);
    const client = new DaemonClient(transport, {
      clientId: asClientId(this.#createClientId(device.id)),
    });
    return {
      device,
      client,
      state: IDLE,
      refCount: 0,
      retryAttempt: 0,
      listeners: new Set(),
      identityListeners: new Set(),
    };
  }

  #isReusable(entry: Entry): boolean {
    return (
      entry.state.name === "idle" ||
      entry.state.name === "connecting" ||
      entry.state.name === "connected" ||
      entry.state.name === "reconnecting"
    );
  }

  #asManaged(entry: Entry): ManagedConnection {
    const self = this;
    return {
      get deviceId(): string {
        return entry.device.id;
      },
      get client(): DaemonClient {
        return entry.client;
      },
      get state(): ConnectionState {
        return entry.state;
      },
      connect: () => self.#connect(entry),
      reconnect: () => {
        if (
          entry.state.name === "error" ||
          entry.state.name === "disconnected" ||
          entry.state.name === "reconnecting"
        ) {
          self.#cancelRetry(entry);
          entry.retryAttempt = 0;
          void self.#connect(entry).catch(() => {});
        }
      },
      disconnect: () => self.#manualDisconnect(entry),
      subscribe: (listener) => self.subscribe(entry.device.id, listener),
    };
  }

  async #connect(entry: Entry): Promise<void> {
    if (entry.pending) return entry.pending;
    // From `idle` / `disconnected` / `error`: legal to enter `connecting`.
    // From `reconnecting`: enter via `retry_attempt` (handled in scheduleRetry).
    if (entry.state.name !== "reconnecting") {
      this.#dispatch(entry, { type: "connect_start" });
    }
    const promise = this.#runConnect(entry);
    entry.pending = promise;
    return promise;
  }

  async #runConnect(entry: Entry): Promise<void> {
    try {
      await entry.client.connect();
      const identity = entry.client.connectionIdentity;
      const normalized: ConnectionIdentity = {
        deviceId: identity.deviceId ? String(identity.deviceId) : undefined,
        deviceDisplayName: identity.deviceDisplayName,
      };
      entry.retryAttempt = 0;
      this.#dispatch(entry, { type: "connected", identity: normalized });
      for (const listener of entry.identityListeners) {
        try {
          listener(normalized);
        } catch {
          // listener errors must not break the pool
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const categorized = categorize({ message });
      this.#dispatch(entry, {
        type: "error",
        reason: categorized.reason,
        message: categorized.message,
      });
      if (categorized.reason === "network" && entry.retryAttempt < MAX_RETRY_ATTEMPTS) {
        this.#scheduleRetry(entry);
      }
    } finally {
      entry.pending = undefined;
    }
  }

  #scheduleRetry(entry: Entry): void {
    if (entry.retryAttempt >= MAX_RETRY_ATTEMPTS) return;
    const attempt = entry.retryAttempt + 1;
    const delay = this.#backoffMs(attempt);
    entry.retryAttempt = attempt;
    entry.retryHandle = this.#setTimeout(() => {
      entry.retryHandle = undefined;
      // error -> reconnecting{attempt}, reconnecting -> connecting.
      this.#dispatch(entry, { type: "retry_attempt", n: attempt });
      this.#dispatch(entry, { type: "retry_attempt", n: attempt });
      void this.#runConnect(entry);
    }, delay);
  }

  #cancelRetry(entry: Entry): void {
    if (entry.retryHandle !== undefined) {
      this.#clearTimeout(entry.retryHandle);
      entry.retryHandle = undefined;
    }
  }

  #manualDisconnect(entry: Entry): void {
    this.#cancelRetry(entry);
    try {
      entry.client.disconnect();
    } catch {
      /* transport may already be closed */
    }
    entry.retryAttempt = 0;
    if (entry.state.name === "connected") {
      this.#dispatch(entry, { type: "disconnect_manual" });
    } else {
      this.#applyRaw(entry, IDLE);
    }
  }

  #tearDown(entry: Entry): void {
    this.#cancelRetry(entry);
    if (entry.idleHandle !== undefined) {
      this.#clearTimeout(entry.idleHandle);
      entry.idleHandle = undefined;
    }
    try {
      entry.client.disconnect();
    } catch {
      /* ignore */
    }
    entry.listeners.clear();
    entry.identityListeners.clear();
  }

  #dispatch(entry: Entry, event: ConnectionEvent): void {
    const next = transition(entry.state, event);
    if (next === entry.state) return;
    entry.state = next;
    this.#emit(entry);
  }

  #applyRaw(entry: Entry, state: ConnectionState): void {
    if (entry.state === state) return;
    entry.state = state;
    this.#emit(entry);
  }

  #emit(entry: Entry): void {
    for (const listener of entry.listeners) {
      try {
        listener(entry.state);
      } catch {
        /* listener errors must not break the pool */
      }
    }
  }
}
