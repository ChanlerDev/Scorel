import { BrowserStore } from "./browser-store";
import { DevicesStore } from "./devices";

export { BrowserStore } from "./browser-store";
export type { StorageLike, BrowserStoreOptions } from "./browser-store";
export { DevicesStore, DEVICES_KEY } from "./devices";
export type { CreateDeviceInput, UpdateDevicePatch } from "./devices";

function quotaLogger(key: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error("[scorel/webui] localStorage quota exceeded", { key, error });
}

export function createDevicesStore(): DevicesStore {
  if (typeof window === "undefined") {
    return new DevicesStore(
      new BrowserStore({ storage: null, onQuotaExceeded: quotaLogger })
    );
  }
  return new DevicesStore(
    new BrowserStore({
      storage: window.localStorage,
      onQuotaExceeded: quotaLogger,
    })
  );
}

// Process-wide shared singleton. Both `useDevices` (UI rendering) and
// `useConnection` (sync helpers) must hold the SAME instance — otherwise
// mutations made from sync land on a separate listener set and the UI
// doesn't re-render. Keep this here and let everyone import via this
// helper.
let _sharedDevicesStore: DevicesStore | null = null;

export function getSharedDevicesStore(): DevicesStore {
  if (_sharedDevicesStore === null) {
    _sharedDevicesStore = createDevicesStore();
  }
  return _sharedDevicesStore;
}

export function __resetSharedDevicesStoreForTests(): void {
  _sharedDevicesStore = null;
}

export function __setSharedDevicesStoreForTests(store: DevicesStore): void {
  _sharedDevicesStore = store;
}

