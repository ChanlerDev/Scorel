"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { Device } from "../domain/devices";
import { syncProjects } from "../sync/projects";
import { syncSessions } from "../sync/sessions";
import {
  __setSharedDevicesStoreForTests,
  getSharedDevicesStore,
  type DevicesStore,
} from "../store";
import { ConnectionPool, type ManagedConnection } from "./pool";
import type { ConnectionIdentity, ConnectionState } from "./state";
import { IDLE } from "./state";

// Module-scoped singletons. HMR may re-init this module in dev; v1 accepts
// that fast-refresh reset. The DevicesStore is shared with `useDevices`
// via `getSharedDevicesStore()` so mutations from sync helpers are
// observed by every consumer in the same render tree.
let _pool: ConnectionPool | null = null;

// Per-device sync error tracking. Updated by `useConnection` after a
// `syncProjects` call resolves; consumed by `useProjectsSyncError` so the
// device page can render a retry banner without reaching into the sync
// module's internals.
const _projectsSyncError = new Map<string, string | undefined>();
const _projectsSyncListeners = new Map<string, Set<() => void>>();

// Per (deviceId, projectId) sync error tracking — same model.
const _sessionsSyncError = new Map<string, string | undefined>();
const _sessionsSyncListeners = new Map<string, Set<() => void>>();

// S0045: track per-device whether the last connect attempt failed with auth
// or unknown reason and the most recent sync threw `transport_disconnected`.
// We use this to gate `syncProjects` / `syncSessions` retries so a stale
// token doesn't flap a spammy retry loop in dev.
const _disconnectStop = new Set<string>();

function isTransportDisconnectedMessage(message: string): boolean {
  return message.startsWith("disconnected:") || /transport_disconnected/.test(message);
}

function sessionsKey(deviceId: string, projectId: string): string {
  return `${deviceId} ${projectId}`;
}

function setSessionsSyncError(
  deviceId: string,
  projectId: string,
  message: string | undefined,
): void {
  const key = sessionsKey(deviceId, projectId);
  if (message === undefined) {
    if (!_sessionsSyncError.has(key)) return;
    _sessionsSyncError.delete(key);
  } else {
    if (_sessionsSyncError.get(key) === message) return;
    _sessionsSyncError.set(key, message);
  }
  const set = _sessionsSyncListeners.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

function setProjectsSyncError(deviceId: string, message: string | undefined): void {
  if (message === undefined) {
    if (!_projectsSyncError.has(deviceId)) return;
    _projectsSyncError.delete(deviceId);
  } else {
    if (_projectsSyncError.get(deviceId) === message) return;
    _projectsSyncError.set(deviceId, message);
  }
  const set = _projectsSyncListeners.get(deviceId);
  if (!set) return;
  for (const listener of set) listener();
}

function getPool(): ConnectionPool {
  if (_pool === null) {
    _pool = new ConnectionPool();
  }
  return _pool;
}

/** Public accessor: same singleton as `useConnection`. Used by the sidebar to
 * subscribe to connection state without holding an acquire() reference. */
export function getConnectionPool(): ConnectionPool {
  return getPool();
}

function getDevicesStore(): DevicesStore {
  return getSharedDevicesStore();
}

/** Public accessor for the singleton DevicesStore — used by routes that
 * trigger sync operations outside of `useConnection`. */
export function getDevicesStoreInstance(): DevicesStore {
  return getDevicesStore();
}

export type UseConnectionResult = {
  state: ConnectionState;
  reconnect(): void;
  disconnect(): void;
  managed: ManagedConnection | null;
  /** Re-run `list_projects` against the current managed client. No-op when
   * the device is not currently connected. */
  syncProjectsNow(): Promise<void>;
  /** Re-run `list_sessions({projectId})` against the current managed
   * client. No-op when not connected. Updates the per-project error map
   * consumed by `useSessionsSyncError`. */
  syncSessionsNow(projectId: string): Promise<void>;
};

export function useConnection(device: Device): UseConnectionResult {
  const pool = getPool();
  const store = getDevicesStore();
  const [managed, setManaged] = useState<ManagedConnection | null>(null);

  useEffect(() => {
    const managedConn = pool.acquire(device, (identity: ConnectionIdentity) => {
      if (identity.deviceId) {
        store.markIdentity(device.id, {
          deviceId: identity.deviceId,
          deviceDisplayName: identity.deviceDisplayName,
        });
      }
      store.markConnectedAt(device.id, Date.now());
    });
    setManaged(managedConn);
    // Subscribe to state transitions so we can fire syncProjects exactly when
    // we enter `connected`. We track the previous state name and only sync on
    // the transition edge to avoid duplicate calls during a steady-state.
    let prevName: ConnectionState["name"] = managedConn.state.name;
    const unsubscribeState = pool.subscribe(device.id, (state) => {
      if (state.name === "connected" && prevName !== "connected") {
        // A successful reconnect clears the disconnect-stop flag so future
        // sync attempts can run again.
        _disconnectStop.delete(device.id);
        setProjectsSyncError(device.id, undefined);
        void syncProjects({
          client: managedConn.client,
          store,
          deviceId: device.id,
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (isTransportDisconnectedMessage(message)) {
            _disconnectStop.add(device.id);
          }
          setProjectsSyncError(device.id, message);
        });
      }
      // S0045 §4.2.iii: when the pool transitions to `error` (auth or
      // unknown), stop firing fresh sync attempts on the dead client. The
      // pool's own retry policy already handles network-class reconnects.
      if (state.name === "error") {
        _disconnectStop.add(device.id);
      }
      prevName = state.name;
    });
    // Handle the case where `acquire()` already returned in `connected`
    // synchronously (rare; the pool kicks off connect asynchronously, but
    // tests may seed state). The subscribe above won't fire for an already-
    // current state, so dispatch an initial sync here.
    if (managedConn.state.name === "connected") {
      setProjectsSyncError(device.id, undefined);
      void syncProjects({
        client: managedConn.client,
        store,
        deviceId: device.id,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setProjectsSyncError(device.id, message);
      });
    }
    return () => {
      unsubscribeState();
      pool.release(device.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, device.link, device.token]);

  const state = useSyncExternalStore(
    (listener) => pool.subscribe(device.id, listener),
    () => pool.state(device.id),
    () => IDLE,
  );

  const syncProjectsNow = useCallback(async (): Promise<void> => {
    if (!managed) return;
    if (managed.state.name !== "connected") return;
    if (_disconnectStop.has(device.id)) return;
    setProjectsSyncError(device.id, undefined);
    try {
      await syncProjects({ client: managed.client, store, deviceId: device.id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTransportDisconnectedMessage(message)) {
        _disconnectStop.add(device.id);
      }
      setProjectsSyncError(device.id, message);
    }
  }, [device.id, managed, store]);

  const syncSessionsNow = useCallback(
    async (projectId: string): Promise<void> => {
      if (!managed) return;
      if (managed.state.name !== "connected") return;
      if (_disconnectStop.has(device.id)) return;
      setSessionsSyncError(device.id, projectId, undefined);
      try {
        await syncSessions({
          client: managed.client,
          store,
          deviceId: device.id,
          projectId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (isTransportDisconnectedMessage(message)) {
          _disconnectStop.add(device.id);
        }
        setSessionsSyncError(device.id, projectId, message);
      }
    },
    [device.id, managed, store],
  );

  return useMemo<UseConnectionResult>(
    () => ({
      state,
      reconnect: () => managed?.reconnect(),
      disconnect: () => managed?.disconnect(),
      managed,
      syncProjectsNow,
      syncSessionsNow,
    }),
    [state, managed, syncProjectsNow, syncSessionsNow],
  );
}

/** Hook: subscribe to the most recent `syncProjects` error for a device, or
 * `undefined` when no error is outstanding (including immediately after a
 * successful sync clears it). */
export function useProjectsSyncError(deviceId: string): string | undefined {
  return useSyncExternalStore<string | undefined>(
    (listener) => {
      let set = _projectsSyncListeners.get(deviceId);
      if (!set) {
        set = new Set();
        _projectsSyncListeners.set(deviceId, set);
      }
      set.add(listener);
      return () => {
        const s = _projectsSyncListeners.get(deviceId);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) _projectsSyncListeners.delete(deviceId);
      };
    },
    () => _projectsSyncError.get(deviceId),
    () => undefined,
  );
}

/** Hook: subscribe to the most recent `syncSessions` error for a (device,
 * projectId). Pass `undefined` projectId to short-circuit. */
export function useSessionsSyncError(
  deviceId: string,
  projectId: string | undefined,
): string | undefined {
  return useSyncExternalStore<string | undefined>(
    (listener) => {
      if (!projectId) return () => {};
      const key = sessionsKey(deviceId, projectId);
      let set = _sessionsSyncListeners.get(key);
      if (!set) {
        set = new Set();
        _sessionsSyncListeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const s = _sessionsSyncListeners.get(key);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) _sessionsSyncListeners.delete(key);
      };
    },
    () =>
      projectId
        ? _sessionsSyncError.get(sessionsKey(deviceId, projectId))
        : undefined,
    () => undefined,
  );
}

// Test seam: clear singletons. Production code does not call this.
export function __resetConnectionForTests(): void {
  if (_pool) _pool.shutdown();
  _pool = null;
  _projectsSyncError.clear();
  _projectsSyncListeners.clear();
  _sessionsSyncError.clear();
  _sessionsSyncListeners.clear();
  _disconnectStop.clear();
}

// Test seam: inject a custom pool/store. Production code does not call this.
export function __setConnectionPoolForTests(pool: ConnectionPool, store?: DevicesStore): void {
  if (_pool && _pool !== pool) _pool.shutdown();
  _pool = pool;
  if (store) {
    // Share the same DevicesStore instance with `useDevices`; otherwise
    // mutations from the pool's identity callback (and sync helpers) are
    // invisible to the page's render path.
    __setSharedDevicesStoreForTests(store);
  }
}
