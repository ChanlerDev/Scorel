export type Listener = () => void;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export type BrowserStoreOptions = {
  storage: StorageLike | null;
  namespace?: string;
  onQuotaExceeded?: (key: string, error: unknown) => void;
};

const DEFAULT_NAMESPACE = "scorel:webui:v2:";

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

export class BrowserStore {
  readonly #storage: StorageLike | null;
  readonly #namespace: string;
  readonly #onQuotaExceeded?: (key: string, error: unknown) => void;
  readonly #listeners = new Map<string, Set<Listener>>();
  #storageHandlerInstalled = false;
  readonly #storageHandler = (event: StorageEvent) => {
    // event.key is the FULL prefixed key (cross-tab).
    if (event.key === null) {
      // Storage cleared — notify everyone.
      for (const set of this.#listeners.values()) {
        for (const l of set) l();
      }
      return;
    }
    const set = this.#listeners.get(event.key);
    if (!set) return;
    for (const l of set) l();
  };

  constructor(opts: BrowserStoreOptions) {
    this.#storage = opts.storage;
    this.#namespace = opts.namespace ?? DEFAULT_NAMESPACE;
    this.#onQuotaExceeded = opts.onQuotaExceeded;
  }

  #fullKey(suffix: string): string {
    return `${this.#namespace}${suffix}`;
  }

  get<T>(key: string): T | undefined {
    if (this.#storage === null) return undefined;
    const full = this.#fullKey(key);
    const raw = this.#storage.getItem(full);
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    const full = this.#fullKey(key);
    if (this.#storage === null) {
      this.#notify(full);
      return;
    }
    const json = JSON.stringify(value);
    try {
      this.#storage.setItem(full, json);
    } catch (err) {
      if (isQuotaError(err)) {
        this.#onQuotaExceeded?.(key, err);
      }
      throw err;
    }
    this.#notify(full);
  }

  remove(key: string): void {
    const full = this.#fullKey(key);
    if (this.#storage === null) {
      this.#notify(full);
      return;
    }
    this.#storage.removeItem(full);
    this.#notify(full);
  }

  subscribe(key: string, listener: Listener): () => void {
    const full = this.#fullKey(key);
    let set = this.#listeners.get(full);
    if (!set) {
      set = new Set();
      this.#listeners.set(full, set);
    }
    set.add(listener);
    this.#installStorageHandler();
    return () => {
      const s = this.#listeners.get(full);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) {
        this.#listeners.delete(full);
      }
    };
  }

  #notify(fullKey: string): void {
    const set = this.#listeners.get(fullKey);
    if (!set) return;
    for (const l of set) l();
  }

  #installStorageHandler(): void {
    if (this.#storageHandlerInstalled) return;
    if (typeof window === "undefined") return;
    window.addEventListener("storage", this.#storageHandler);
    this.#storageHandlerInstalled = true;
  }
}
