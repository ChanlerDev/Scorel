"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { Device } from "../domain/devices";
import { createDevicesStore, type DevicesStore } from "../store";
import { ConnectionPool, type ManagedConnection } from "./pool";
import type { ConnectionIdentity, ConnectionState } from "./state";
import { IDLE } from "./state";

// Module-scoped singletons. HMR may re-init this module in dev; v1 accepts
// that fast-refresh reset.
let _pool: ConnectionPool | null = null;
let _devicesStore: DevicesStore | null = null;

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
  if (_devicesStore === null) {
    _devicesStore = createDevicesStore();
  }
  return _devicesStore;
}

export type UseConnectionResult = {
  state: ConnectionState;
  reconnect(): void;
  disconnect(): void;
  managed: ManagedConnection | null;
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
    return () => {
      pool.release(device.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, device.link, device.token]);

  const state = useSyncExternalStore(
    (listener) => pool.subscribe(device.id, listener),
    () => pool.state(device.id),
    () => IDLE,
  );

  return useMemo<UseConnectionResult>(
    () => ({
      state,
      reconnect: () => managed?.reconnect(),
      disconnect: () => managed?.disconnect(),
      managed,
    }),
    [state, managed],
  );
}

// Test seam: clear singletons. Production code does not call this.
export function __resetConnectionForTests(): void {
  if (_pool) _pool.shutdown();
  _pool = null;
  _devicesStore = null;
}

// Test seam: inject a custom pool/store. Production code does not call this.
export function __setConnectionPoolForTests(pool: ConnectionPool, store?: DevicesStore): void {
  if (_pool && _pool !== pool) _pool.shutdown();
  _pool = pool;
  if (store) _devicesStore = store;
}
