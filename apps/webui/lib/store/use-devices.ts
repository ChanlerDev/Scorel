"use client";

import { useSyncExternalStore } from "react";
import {
  __resetSharedDevicesStoreForTests,
  __setSharedDevicesStoreForTests,
  getSharedDevicesStore,
  type DevicesStore,
} from "./index";
import type { Device } from "../domain/devices";

const SSR_SNAPSHOT: Device[] = [];

export function useDevices(): { devices: Device[]; store: DevicesStore } {
  const store = getSharedDevicesStore();
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
  __resetSharedDevicesStoreForTests();
}

export function __setDevicesStoreForTests(store: DevicesStore): void {
  __setSharedDevicesStoreForTests(store);
}
