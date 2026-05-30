"use client";

import { useSyncExternalStore } from "react";
import { createDevicesStore, type DevicesStore } from "./index";
import type { Device } from "../domain/devices";

let _store: DevicesStore | null = null;

function getStore(): DevicesStore {
  if (_store === null) {
    _store = createDevicesStore();
  }
  return _store;
}

const SSR_SNAPSHOT: Device[] = [];

export function useDevices(): { devices: Device[]; store: DevicesStore } {
  const store = getStore();
  const devices = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.list(),
    () => SSR_SNAPSHOT
  );
  return { devices, store };
}

// Test seam: reset the module-scoped singleton so a subsequent useDevices()
// call re-reads localStorage.
export function __resetDevicesStoreForTests(): void {
  _store = null;
}
