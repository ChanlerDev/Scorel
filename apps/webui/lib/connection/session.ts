"use client";

import type { DaemonClient } from "@scorel/client";
import {
  asSeq,
  type PersistentEvent,
  type ScorelEvent,
  type SendMessageOptions,
  type Seq,
  type SessionId,
} from "@scorel/protocol";

import { createRafBatcher } from "../events/delta-batch";
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
 * Classify a thrown cause from a `client.*` call into a {reason, message}
 * pair for `snapshot.error`. The transport-disconnected case (S0045 §4.2)
 * is detected via `code === "transport_disconnected"` — the public
 * `TransportDisconnectedError` class set by `@scorel/client` carries it.
 * All other causes fall through to the caller-supplied fallback reason
 * (resync_failed / send_failed / cancel_failed).
 */
function classifyError(
  cause: unknown,
  fallback: Exclude<SessionError["reason"], "disconnected">,
): SessionError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code =
    typeof cause === "object" && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  if (code === "transport_disconnected") {
    return { reason: "disconnected", message };
  }
  return { reason: fallback, message };
}

export type SessionError =
  | { reason: "resync_failed"; message: string }
  | { reason: "send_failed"; message: string }
  | { reason: "cancel_failed"; message: string }
  | { reason: "disconnected"; message: string };

/**
 * Session attach controller. Glues together the attach-cache, daemon resync
 * and the event projector for a single (scopeKey, sessionId) attachment.
 *
 * Lifecycle:
 *   start()  — hydrate from cache, connect/resync, subscribe to events.
 *   stop()   — unsubscribe (the underlying client connection is pool-managed).
 *   send()   — call client.sendMessage; insert an optimistic local user turn
 *              keyed by a placeholder id that is replaced when the daemon
 *              echoes the persistent user_message back. The send promise
 *              resolves from the matching persistent user_message/queue_update,
 *              not from a request-level accepted acknowledgement.
 *   cancel() — best-effort dispatch of `client.cancel()`; sets
 *              `cancelling=true` until the next `turn_end` (or daemon error)
 *              so the composer can render an optimistic "Cancelling…" state.
 *
 * Snapshot lifecycle: callers receive a `SessionAttachSnapshot` via
 * `onState()` after every applied event. The snapshot is immutable from the
 * caller's perspective (the controller produces fresh objects on each emit).
 */

export type SessionAttachOptions = {
  client: DaemonClient;
  scopeKey: string;
  sessionId: SessionId;
  projectId: string;
  attachCache: AttachCache;
  onState: (snapshot: SessionAttachSnapshot) => void;
};

export type SessionAttachSnapshot = {
  loading: boolean;
  state: ProjectorState;
  resyncMode?: "stream_resume" | "persistent_fallback" | "full_reload";
  error?: SessionError;
  /** True between `turn_start` and `turn_end` for the current session. */
  inFlight: boolean;
  /**
   * True between a user-issued `cancel()` call and the subsequent `turn_end`
   * (regardless of stopReason). Cleared on daemon error response so the user
   * can retry.
   */
  cancelling: boolean;
  /** Highest persistent seq applied so far (diagnostic). */
  persistentLastSeq: number;
  /** Highest stream seq applied so far (diagnostic). */
  streamLastSeq: number;
  /** Identity of the daemon we're attached to (diagnostic). */
  remoteDeviceId?: string;
  /** Project this session belongs to (diagnostic). */
  projectId?: string;
  /** Session id this controller is attached to. */
  sessionId: string;
};

export type SessionAttachController = {
  start(): Promise<void>;
  stop(): void;
  send(content: string, options?: Pick<SendMessageOptions, "runningBehavior">): Promise<void>;
  cancel(): Promise<void>;
};

const PENDING_USER_PREFIX = "pending_user_";

let pendingCounter = 0;
function nextPendingId(): string {
  pendingCounter += 1;
  return `${PENDING_USER_PREFIX}${Date.now().toString(36)}_${pendingCounter}`;
}

type PendingSendAcceptance = {
  content: string;
  persistentAnchor: number;
  streamAnchor: number;
  runningBehavior?: NonNullable<SendMessageOptions["runningBehavior"]>;
  resolve: () => void;
  reject: (cause: unknown) => void;
};

export function createSessionAttachController(
  opts: SessionAttachOptions,
): SessionAttachController {
  const { client, scopeKey, sessionId, projectId, attachCache, onState } = opts;

  let state = emptyProjectorState();
  let unsubscribe: (() => void) | undefined;
  let stopped = false;
  let resyncMode: SessionAttachSnapshot["resyncMode"];
  let error: SessionAttachSnapshot["error"];
  let inFlight = false;
  let cancelling = false;
  let persistentLastSeq = 0;
  let streamLastSeq = 0;
  let pendingAcceptances: PendingSendAcceptance[] = [];
  // Until `start()` returns we suppress the live-subscribe handler from
  // emitting (resync's dispatched events will pass through here, but we
  // want a single batched emit at the end of start() rather than one per
  // event during the initial hydration).
  let initializing = true;

  const scopeForCache: AttachCacheKey = {
    scopeKey,
    sessionId: String(sessionId),
  };

  function readClientIdentity(): {
    remoteDeviceId?: string;
    projectId?: string;
  } {
    const identity = client.connectionIdentity;
    return {
      ...(identity.deviceId ? { remoteDeviceId: String(identity.deviceId) } : {}),
      projectId,
    };
  }

  function emit(loading: boolean): void {
    if (stopped) return;
    const identity = readClientIdentity();
    onState({
      loading,
      state,
      ...(resyncMode ? { resyncMode } : {}),
      ...(error ? { error } : {}),
      inFlight,
      cancelling,
      persistentLastSeq,
      streamLastSeq,
      ...(identity.remoteDeviceId ? { remoteDeviceId: identity.remoteDeviceId } : {}),
      projectId: identity.projectId,
      sessionId: String(sessionId),
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

  function trackInFlight(event: ScorelEvent): void {
    if (event.type === "turn_start") {
      inFlight = true;
      cancelling = false;
      return;
    }
    if (event.type === "turn_end") {
      inFlight = false;
      cancelling = false;
    }
  }

  function trackSeq(event: ScorelEvent): void {
    const n = Number(event.seq);
    if (Number.isFinite(n) && n > streamLastSeq) {
      streamLastSeq = n;
    }
    if ("id" in event && Number.isFinite(n) && n > persistentLastSeq) {
      persistentLastSeq = n;
    }
  }

  function waitForPersistentAcceptance(
    content: string,
    runningBehavior?: SendMessageOptions["runningBehavior"],
  ): {
    pending: PendingSendAcceptance;
    promise: Promise<void>;
  } {
    let pending!: PendingSendAcceptance;
    const promise = new Promise<void>((resolve, reject) => {
      pending = {
        content,
        persistentAnchor: persistentLastSeq,
        streamAnchor: streamLastSeq,
        ...(runningBehavior ? { runningBehavior } : {}),
        resolve,
        reject,
      };
      pendingAcceptances = [...pendingAcceptances, pending];
    });
    return { pending, promise };
  }

  function isPendingAcceptance(pending: PendingSendAcceptance): boolean {
    return pendingAcceptances.includes(pending);
  }

  function settlePendingAcceptance(pending: PendingSendAcceptance, cause?: unknown): void {
    if (!pendingAcceptances.includes(pending)) return;
    pendingAcceptances = pendingAcceptances.filter((candidate) => candidate !== pending);
    if (cause) {
      pending.reject(cause);
      return;
    }
    pending.resolve();
  }

  function resolveAcceptedSends(event: ScorelEvent): void {
    const accepted = pendingAcceptances.find((pending) => isAcceptedByEvent(event, pending, String(client.clientId)));
    if (accepted) {
      settlePendingAcceptance(accepted);
    }
  }

  // Coalesce text_delta snapshots into one emit per animation frame. Other
  // event kinds (turn_*, message_*, persistent assistant_message, errors)
  // flush synchronously and cancel any pending frame so the final state
  // never lags behind a stale rAF tick. See S0042 spec §rAF-batched.
  const deltaBatcher = createRafBatcher(() => {
    if (stopped) return;
    if (initializing) return;
    emit(false);
  });

  function applyEvent(event: ScorelEvent): void {
    state = projectEvent(state, event);
    persistEvent(event);
    trackInFlight(event);
    trackSeq(event);
    resolveAcceptedSends(event);
    if (initializing) return;
    if (event.type === "text_delta") {
      deltaBatcher.schedule();
      return;
    }
    // Any non-delta event flushes immediately — drop the pending rAF first so
    // we never overwrite the just-emitted authoritative state with a stale
    // batched snapshot.
    deltaBatcher.cancel();
    emit(false);
  }

  async function start(): Promise<void> {
    if (stopped) return;
    initializing = true;

    // 1. Hydrate from attach-cache for instant first paint.
    const cached = readCache();
    if (cached) {
      state = projectEvents(emptyProjectorState(), cached.events);
      const cachedHigh = Number(highestSeq(cached.events));
      persistentLastSeq = cachedHigh;
      streamLastSeq = cachedHigh;
    } else {
      ensureCacheFile();
    }
    emit(true);

    // 2. Compute resync anchors.
    const persistentAnchor = highestSeq(cached?.events ?? []);
    // Per spec: cached transients before the boundary are not authoritative;
    // use persistent boundary as stream anchor for v1 simplicity.
    const streamAnchor = persistentAnchor;

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
      const loaded = await client.loadSession(sessionId);
      if (String(loaded.meta.projectId) !== projectId) {
        throw new Error(`Session project mismatch: expected ${projectId}, got ${loaded.meta.projectId}`);
      }
      const resync = await client.resync({
        persistentLastSeq: persistentAnchor,
        streamLastSeq: streamAnchor,
      });
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
      error = classifyError(cause, "resync_failed");
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
    deltaBatcher.cancel();
    for (const pending of pendingAcceptances) {
      pending.reject(new Error("Session attach stopped before send acceptance"));
    }
    pendingAcceptances = [];
    unsubscribe?.();
    unsubscribe = undefined;
  }

  async function send(content: string, options?: Pick<SendMessageOptions, "runningBehavior">): Promise<void> {
    if (stopped) return;
    if (!content.trim()) return;
    const shouldAppendPendingUserTurn = !inFlight;
    const placeholderId = shouldAppendPendingUserTurn ? nextPendingId() : undefined;
    if (placeholderId) {
      // Optimistic local user turn so the user sees their input immediately.
      state = appendPendingUserTurn(state, { id: placeholderId, text: content });
      emit(false);
    }
    const acceptance = waitForPersistentAcceptance(content, options?.runningBehavior);
    try {
      void client.sendMessage(content, {
        runningBehavior: options?.runningBehavior,
      }).then(async () => {
        if (!isPendingAcceptance(acceptance.pending)) return;
        await client.resync({
          persistentLastSeq: asSeq(acceptance.pending.persistentAnchor),
          streamLastSeq: asSeq(acceptance.pending.streamAnchor),
        });
        if (isPendingAcceptance(acceptance.pending)) {
          settlePendingAcceptance(
            acceptance.pending,
            new Error("send_message completed without matching persistent event"),
          );
        }
      }).catch((cause) => {
        settlePendingAcceptance(acceptance.pending, cause);
      });
      await acceptance.promise;
    } catch (cause) {
      // Drop the placeholder on failure and surface the error.
      state = {
        ...state,
        turns: placeholderId ? state.turns.filter((t) => t.id !== placeholderId) : state.turns,
      };
      error = classifyError(cause, "send_failed");
      emit(false);
      throw cause;
    }
  }

  async function cancel(): Promise<void> {
    if (stopped) return;
    // Optimistic UI: surface "Cancelling…" immediately. Final clear comes from
    // the daemon's `turn_end` (any stopReason). On daemon-side error response,
    // we capture it into `snapshot.error` and clear `cancelling` so the user
    // can re-issue cancel or send a new prompt.
    cancelling = true;
    error = undefined;
    emit(false);
    try {
      await client.cancel();
    } catch (cause) {
      cancelling = false;
      error = classifyError(cause, "cancel_failed");
      emit(false);
    }
  }

  return { start, stop, send, cancel };
}

function isAcceptedByEvent(
  event: ScorelEvent,
  pending: PendingSendAcceptance,
  clientId: string,
): boolean {
  if (Number(event.seq) <= pending.persistentAnchor) return false;
  if (pending.runningBehavior) {
    return (
      event.type === "queue_update" &&
      event.queue === pending.runningBehavior &&
      String(event.clientId) === clientId &&
      event.items.some(
        (item) =>
          String(item.clientId) === clientId &&
          textFromContent(item.content) === pending.content,
      )
    );
  }
  return (
    event.type === "user_message" &&
    String(event.clientId) === clientId &&
    textFromContent(event.message.content) === pending.content
  );
}

function textFromContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
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
