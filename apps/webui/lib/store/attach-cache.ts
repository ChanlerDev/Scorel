import type { PersistentEvent } from "@scorel/protocol";

import type { BrowserStore } from "./browser-store";

/**
 * Attach-cache for the WebUI. Mirrors the CLI's on-disk cache file shape so
 * an offline-first chatbox can render history instantly while the daemon
 * resync runs in the background.
 *
 * Storage layout (within a `BrowserStore` whose namespace is
 * `scorel:webui:v2:`):
 *
 *   attach-cache:<scopeKey>:<sessionId>   →  AttachCacheFile  (one per session)
 *   attach-cache:lru                      →  string[]         (LRU sidecar)
 *
 * Key naming intentionally reuses the CLI's `scopeKey` (24 hex chars of
 * `sha256(kind\0locator)`) so future cross-runtime parity tests can compare.
 *
 * Quota fallback strategy (enforced by `onQuotaExceeded`): try to drop the
 * oldest transients of the affected session first, then evict the
 * least-recently-used non-current session's cache. After a few retries we
 * fall back to in-memory only and log a warning.
 */

export type AttachCacheScope = {
  kind: "remote";
  locator: string;
};

export type AttachTransientCacheEntry = {
  eventId?: string;
  seq: number;
  text: string;
};

export type AttachCacheFile = {
  version: 1;
  scope: AttachCacheScope;
  sessionId: string;
  events: PersistentEvent[];
  transients?: AttachTransientCacheEntry[];
};

export type AttachCacheKey = {
  scopeKey: string;
  sessionId: string;
};

const CACHE_KEY_PREFIX = "attach-cache:";
const LRU_KEY = "attach-cache:lru";

const MAX_RETRY_ATTEMPTS = 3;

function fileKey(scopeKey: string, sessionId: string): string {
  return `${CACHE_KEY_PREFIX}${scopeKey}:${sessionId}`;
}

function lruEntry(scopeKey: string, sessionId: string): string {
  // ` ` separator between scopeKey and sessionId so we can split deterministically.
  return `${scopeKey}${String.fromCharCode(0)}${sessionId}`;
}

function parseLruEntry(value: string): { scopeKey: string; sessionId: string } | null {
  const sep = value.indexOf(String.fromCharCode(0));
  if (sep <= 0) return null;
  const scopeKey = value.slice(0, sep);
  const sessionId = value.slice(sep + 1);
  if (!scopeKey || !sessionId) return null;
  return { scopeKey, sessionId };
}

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

export class AttachCache {
  readonly #store: BrowserStore;
  // In-memory fallback for sessions whose persisted writes failed after the
  // quota retry budget. Keeps the running session usable but forfeits
  // refresh-resume for that session.
  readonly #memoryFallback = new Map<string, AttachCacheFile>();

  constructor(store: BrowserStore) {
    this.#store = store;
  }

  /**
   * Read the cached snapshot for (scopeKey, sessionId). Returns `undefined`
   * when the cache is missing or corrupt. Touches the LRU so the entry stays
   * hot.
   */
  read(scopeKey: string, sessionId: string): AttachCacheFile | undefined {
    const memoryHit = this.#memoryFallback.get(fileKey(scopeKey, sessionId));
    if (memoryHit) {
      this.#touchLru(scopeKey, sessionId);
      return memoryHit;
    }
    const raw = this.#store.get<AttachCacheFile>(fileKey(scopeKey, sessionId));
    if (!raw || raw.version !== 1 || raw.sessionId !== sessionId) return undefined;
    if (!raw.scope || raw.scope.kind !== "remote") return undefined;
    if (!Array.isArray(raw.events)) return undefined;
    this.#touchLru(scopeKey, sessionId);
    return raw;
  }

  /**
   * Write a full snapshot for (scopeKey, sessionId). On QuotaExceededError
   * the cache attempts a few rounds of remediation before falling back to an
   * in-memory copy. The current session's scope must be passed so the LRU
   * eviction never blows away the session the user is looking at.
   */
  write(
    scopeKey: string,
    sessionId: string,
    file: AttachCacheFile,
    currentSessionScope?: AttachCacheKey,
  ): void {
    const key = fileKey(scopeKey, sessionId);
    let attempt = 0;
    let lastError: unknown;
    while (attempt < MAX_RETRY_ATTEMPTS) {
      try {
        this.#store.set(key, file);
        this.#memoryFallback.delete(key);
        this.#touchLru(scopeKey, sessionId);
        return;
      } catch (err) {
        lastError = err;
        if (!isQuotaError(err)) {
          throw err;
        }
        attempt += 1;
        const handled = this.onQuotaExceeded(
          { scopeKey, sessionId },
          err,
          currentSessionScope ?? { scopeKey, sessionId },
          file,
        );
        if (!handled) break;
      }
    }
    // Quota retries exhausted — fall back to memory and warn loudly.
    this.#memoryFallback.set(key, file);
    this.#touchLru(scopeKey, sessionId);
    // eslint-disable-next-line no-console
    console.warn(
      "[scorel/webui] attach-cache write fell back to memory after quota retries",
      { scopeKey, sessionId, lastError },
    );
  }

  /**
   * Append a single persistent event, dedup by id. No-op if the cache for
   * (scopeKey, sessionId) is missing — caller must `write()` an initial
   * snapshot first.
   */
  appendPersistent(
    scopeKey: string,
    sessionId: string,
    event: PersistentEvent,
    currentSessionScope?: AttachCacheKey,
  ): void {
    const existing = this.read(scopeKey, sessionId);
    if (!existing) return;
    if (existing.events.some((candidate) => candidate.id === event.id)) {
      // Already present; treat as upsert by replacing in place to capture
      // any field updates the daemon may have re-emitted.
      const next = existing.events.map((candidate) =>
        candidate.id === event.id ? event : candidate,
      );
      this.write(
        scopeKey,
        sessionId,
        { ...existing, events: next },
        currentSessionScope,
      );
      return;
    }
    const next: AttachCacheFile = {
      ...existing,
      events: [...existing.events, event],
    };
    this.write(scopeKey, sessionId, next, currentSessionScope);
  }

  /**
   * Append a single transient text fragment to the cache. Dedup by `eventId`
   * when present (subsequent deltas concatenate to the same entry).
   */
  appendTransient(
    scopeKey: string,
    sessionId: string,
    entry: AttachTransientCacheEntry,
    currentSessionScope?: AttachCacheKey,
  ): void {
    const existing = this.read(scopeKey, sessionId);
    if (!existing) return;
    const transients = existing.transients ? [...existing.transients] : [];
    const matchIdx =
      entry.eventId !== undefined
        ? transients.findIndex((t) => t.eventId === entry.eventId)
        : -1;
    if (matchIdx >= 0) {
      const merged = transients[matchIdx]!;
      transients[matchIdx] = {
        eventId: merged.eventId ?? entry.eventId,
        seq: Math.max(merged.seq, entry.seq),
        text: merged.text + entry.text,
      };
    } else {
      transients.push(entry);
    }
    this.write(
      scopeKey,
      sessionId,
      { ...existing, transients },
      currentSessionScope,
    );
  }

  /**
   * Drop all cached transients for (scopeKey, sessionId). Called on
   * `turn_end` when the daemon has finalized the assistant_message and the
   * deltas are no longer needed.
   */
  truncateTransients(
    scopeKey: string,
    sessionId: string,
    currentSessionScope?: AttachCacheKey,
  ): void {
    const existing = this.read(scopeKey, sessionId);
    if (!existing) return;
    if (!existing.transients || existing.transients.length === 0) return;
    this.write(
      scopeKey,
      sessionId,
      { ...existing, transients: [] },
      currentSessionScope,
    );
  }

  remove(scopeKey: string, sessionId: string): void {
    const key = fileKey(scopeKey, sessionId);
    this.#store.remove(key);
    this.#memoryFallback.delete(key);
    this.#removeFromLru(scopeKey, sessionId);
  }

  /**
   * Quota fallback handler. Returns true when remediation freed (or may have
   * freed) space and the caller should retry the write. Returns false when
   * no remediation was possible (caller should give up and fall back to
   * memory).
   */
  onQuotaExceeded(
    victim: AttachCacheKey,
    _error: unknown,
    currentSessionScope: AttachCacheKey,
    pendingFile: AttachCacheFile,
  ): boolean {
    // 1. If the affected session has cached transients, drop them first —
    //    they're cheap losses (deltas re-streamed on resync).
    if (pendingFile.transients && pendingFile.transients.length > 0) {
      pendingFile.transients = [];
      return true;
    }
    // 2. Look at the current persisted file for the victim and clear its
    //    transients there too in case `pendingFile` was already lean.
    const current = this.#store.get<AttachCacheFile>(fileKey(victim.scopeKey, victim.sessionId));
    if (current && current.transients && current.transients.length > 0) {
      try {
        this.#store.set(
          fileKey(victim.scopeKey, victim.sessionId),
          { ...current, transients: [] },
        );
        return true;
      } catch {
        // fall through to LRU eviction
      }
    }
    // 3. Evict the LRU non-current session's cache.
    const evicted = this.#evictLruExcept(currentSessionScope);
    if (evicted) return true;
    return false;
  }

  // --- internals ---------------------------------------------------------

  #lru(): string[] {
    return this.#store.get<string[]>(LRU_KEY) ?? [];
  }

  #setLru(list: string[]): void {
    try {
      this.#store.set(LRU_KEY, list);
    } catch {
      // The LRU sidecar is best-effort; don't block writes when it fails.
    }
  }

  #touchLru(scopeKey: string, sessionId: string): void {
    const entry = lruEntry(scopeKey, sessionId);
    const list = this.#lru().filter((value) => value !== entry);
    list.push(entry);
    this.#setLru(list);
  }

  #removeFromLru(scopeKey: string, sessionId: string): void {
    const entry = lruEntry(scopeKey, sessionId);
    const list = this.#lru().filter((value) => value !== entry);
    this.#setLru(list);
  }

  #evictLruExcept(currentSessionScope: AttachCacheKey): boolean {
    const list = this.#lru();
    for (const entry of list) {
      const parsed = parseLruEntry(entry);
      if (!parsed) continue;
      if (
        parsed.scopeKey === currentSessionScope.scopeKey &&
        parsed.sessionId === currentSessionScope.sessionId
      ) {
        continue;
      }
      this.remove(parsed.scopeKey, parsed.sessionId);
      return true;
    }
    return false;
  }
}
