"use client";

import type { DaemonClient } from "@scorel/client";
import {
  asSeq,
  type PersistentEvent,
  type ScorelEvent,
  type Seq,
  type SessionId,
} from "@scorel/protocol";

import {
  appendPendingUserTurn,
  emptyProjectorState,
  projectEvent,
  projectEvents,
  type ProjectorState,
} from "../events/projector";
import {
  AttachCache,
  type AttachCacheFile,
  type AttachCacheKey,
} from "../store/attach-cache";

/**
 * Session attach controller. Glues together the attach-cache, daemon resync
 * and the event projector for a single (scopeKey, sessionId) attachment.
 *
 * Lifecycle:
 *   start()  — hydrate from cache, connect/resync, subscribe to events.
 *   stop()   — unsubscribe (the underlying client connection is pool-managed).
 *   send()   — call client.sendMessage; insert an optimistic local user turn
 *              keyed by a placeholder id that is replaced when the daemon
 *              echoes the persistent user_message back.
 *
 * Snapshot lifecycle: callers receive a `SessionAttachSnapshot` via
 * `onState()` after every applied event. The snapshot is immutable from the
 * caller's perspective (the controller produces fresh objects on each emit).
 */

export type SessionAttachOptions = {
  client: DaemonClient;
  scopeKey: string;
  sessionId: SessionId;
  attachCache: AttachCache;
  onState: (snapshot: SessionAttachSnapshot) => void;
};

export type SessionAttachSnapshot = {
  loading: boolean;
  state: ProjectorState;
  resyncMode?: "stream_resume" | "persistent_fallback" | "full_reload";
  error?: { reason: string; message: string };
};

export type SessionAttachController = {
  start(): Promise<void>;
  stop(): void;
  send(content: string): Promise<void>;
};

const PENDING_USER_PREFIX = "pending_user_";

let pendingCounter = 0;
function nextPendingId(): string {
  pendingCounter += 1;
  return `${PENDING_USER_PREFIX}${Date.now().toString(36)}_${pendingCounter}`;
}

export function createSessionAttachController(
  opts: SessionAttachOptions,
): SessionAttachController {
  const { client, scopeKey, sessionId, attachCache, onState } = opts;

  let state = emptyProjectorState();
  let unsubscribe: (() => void) | undefined;
  let stopped = false;
  let resyncMode: SessionAttachSnapshot["resyncMode"];
  let error: SessionAttachSnapshot["error"];
  // Until `start()` returns we suppress the live-subscribe handler from
  // emitting (resync's dispatched events will pass through here, but we
  // want a single batched emit at the end of start() rather than one per
  // event during the initial hydration).
  let initializing = true;

  const scopeForCache: AttachCacheKey = {
    scopeKey,
    sessionId: String(sessionId),
  };

  function emit(loading: boolean): void {
    if (stopped) return;
    onState({
      loading,
      state,
      ...(resyncMode ? { resyncMode } : {}),
      ...(error ? { error } : {}),
    });
  }

  function readCache(): AttachCacheFile | undefined {
    return attachCache.read(scopeKey, String(sessionId));
  }

  function writeCacheFresh(events: PersistentEvent[]): void {
    attachCache.write(
      scopeKey,
      String(sessionId),
      {
        version: 1,
        scope: { kind: "remote", locator: locatorPlaceholder(scopeKey) },
        sessionId: String(sessionId),
        events,
        transients: [],
      },
      scopeForCache,
    );
  }

  function ensureCacheFile(): void {
    const existing = readCache();
    if (existing) return;
    writeCacheFresh([]);
  }

  function persistEvent(event: ScorelEvent): void {
    if ("id" in event) {
      attachCache.appendPersistent(scopeKey, String(sessionId), event, scopeForCache);
      return;
    }
    if (event.type === "text_delta") {
      attachCache.appendTransient(
        scopeKey,
        String(sessionId),
        {
          eventId: String(event.eventId),
          seq: Number(event.seq),
          text: event.delta,
        },
        scopeForCache,
      );
      return;
    }
    if (event.type === "turn_end") {
      attachCache.truncateTransients(scopeKey, String(sessionId), scopeForCache);
    }
  }

  function applyEvent(event: ScorelEvent): void {
    state = projectEvent(state, event);
    persistEvent(event);
    if (!initializing) emit(false);
  }

  async function start(): Promise<void> {
    if (stopped) return;
    initializing = true;

    // 1. Hydrate from attach-cache for instant first paint.
    const cached = readCache();
    if (cached) {
      state = projectEvents(emptyProjectorState(), cached.events);
    } else {
      ensureCacheFile();
    }
    emit(true);

    // 2. Compute resync anchors.
    const persistentLastSeq = highestSeq(cached?.events ?? []);
    // Per spec: cached transients before the boundary are not authoritative;
    // use persistent boundary as stream anchor for v1 simplicity.
    const streamLastSeq = persistentLastSeq;

    // 3. Subscribe BEFORE resync so resync-dispatched events flow through
    //    the same projection path as live events. The handler is gated by
    //    `initializing` so resync events accumulate quietly into `state`.
    unsubscribe = client.subscribe((event) => {
      applyEvent(event);
    });

    // 4. Connect (if needed) then resync.
    try {
      if (client.sessionId !== sessionId) {
        await client.connect(sessionId);
      }
      const resync = await client.resync({ persistentLastSeq, streamLastSeq });
      resyncMode = resync.mode;

      if (resync.mode === "full_reload") {
        // Authoritative reload — drop projector state, re-project from the
        // persistent events (transients in the response, if any, were
        // already applied by the subscriber but get reapplied below since
        // they're not in `appliedSeqs` after the reset).
        state = emptyProjectorState();
        for (const event of resync.events) {
          state = projectEvent(state, event);
        }
        const persistents = resync.events.filter(
          (e): e is PersistentEvent => "id" in e,
        );
        writeCacheFresh(persistents);
      }
    } catch (cause) {
      error = {
        reason: "resync_failed",
        message: cause instanceof Error ? cause.message : String(cause),
      };
      initializing = false;
      emit(false);
      return;
    }

    if (stopped) return;

    initializing = false;
    emit(false);
  }

  function stop(): void {
    stopped = true;
    unsubscribe?.();
    unsubscribe = undefined;
  }

  async function send(content: string): Promise<void> {
    if (stopped) return;
    if (!content.trim()) return;
    // Optimistic local user turn so the user sees their input immediately.
    const placeholderId = nextPendingId();
    state = appendPendingUserTurn(state, { id: placeholderId, text: content });
    emit(false);
    try {
      await client.sendMessage(content);
    } catch (cause) {
      // Drop the placeholder on failure and surface the error.
      state = {
        ...state,
        turns: state.turns.filter((t) => t.id !== placeholderId),
      };
      error = {
        reason: "send_failed",
        message: cause instanceof Error ? cause.message : String(cause),
      };
      emit(false);
      throw cause;
    }
  }

  return { start, stop, send };
}

function highestSeq(events: PersistentEvent[]): Seq {
  let max = 0;
  for (const event of events) {
    const n = Number(event.seq);
    if (n > max) max = n;
  }
  return asSeq(max);
}

/**
 * The cache file schema requires a `locator`, but the controller only knows
 * the (already-hashed) scopeKey. The locator is informational from the
 * controller's perspective — daemon identity is the source of truth — so we
 * stash the scopeKey itself when we have to invent one. A future spec could
 * round-trip the locator through identity if anyone needs to read it.
 */
function locatorPlaceholder(scopeKey: string): string {
  return `scope:${scopeKey}`;
}
