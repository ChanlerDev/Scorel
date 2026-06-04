import { AttachCache } from "./attach-cache";
import { BrowserStore } from "./browser-store";
import { DevicesStore } from "./devices";
import { RunningBehaviorStore } from "./running-behavior";

export { BrowserStore } from "./browser-store";
export type { StorageLike, BrowserStoreOptions } from "./browser-store";
export { DevicesStore, DEVICES_KEY } from "./devices";
export type { CreateDeviceInput, UpdateDevicePatch } from "./devices";
export {
  DEFAULT_RUNNING_BEHAVIOR,
  RUNNING_BEHAVIOR_KEY,
  RunningBehaviorStore,
  oppositeRunningBehavior,
} from "./running-behavior";
export type { RunningMessageBehavior } from "./running-behavior";
export { AttachCache } from "./attach-cache";
export type {
  AttachCacheFile,
  AttachCacheKey,
  AttachCacheScope,
  AttachTransientCacheEntry,
} from "./attach-cache";

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

// Process-wide shared AttachCache singleton — same browser-store-backed
// pattern as DevicesStore. Held here so the session attach controller and
// any future ancillary readers (e.g. an inspector) see the same instance.
let _sharedAttachCache: AttachCache | null = null;

export function getSharedAttachCache(): AttachCache {
  if (_sharedAttachCache === null) {
    if (typeof window === "undefined") {
      _sharedAttachCache = new AttachCache(
        new BrowserStore({ storage: null, onQuotaExceeded: quotaLogger }),
      );
    } else {
      _sharedAttachCache = new AttachCache(
        new BrowserStore({
          storage: window.localStorage,
          onQuotaExceeded: quotaLogger,
        }),
      );
    }
  }
  return _sharedAttachCache;
}

export function __resetSharedAttachCacheForTests(): void {
  _sharedAttachCache = null;
}

export function __setSharedAttachCacheForTests(cache: AttachCache): void {
  _sharedAttachCache = cache;
}

let _sharedRunningBehaviorStore: RunningBehaviorStore | null = null;

export function getSharedRunningBehaviorStore(): RunningBehaviorStore {
  if (_sharedRunningBehaviorStore === null) {
    _sharedRunningBehaviorStore = new RunningBehaviorStore(
      new BrowserStore({
        storage: typeof window === "undefined" ? null : window.localStorage,
        onQuotaExceeded: quotaLogger,
      }),
    );
  }
  return _sharedRunningBehaviorStore;
}

export function __resetSharedRunningBehaviorStoreForTests(): void {
  _sharedRunningBehaviorStore = null;
}

export function __setSharedRunningBehaviorStoreForTests(store: RunningBehaviorStore): void {
  _sharedRunningBehaviorStore = store;
}
