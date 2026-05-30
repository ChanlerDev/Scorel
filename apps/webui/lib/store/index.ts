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
