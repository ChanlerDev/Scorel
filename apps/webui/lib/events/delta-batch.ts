"use client";

/**
 * Animation-frame coalescer for high-frequency state changes (S0042).
 *
 * Used by the session attach controller to defer `text_delta` snapshot
 * emission to the next frame so that 100 token/sec streams trigger one
 * markdown re-parse per frame instead of one per token. Non-delta events
 * (turn_end, message_end, persistent assistant_message, errors) flush
 * synchronously and `cancel()` any pending batch — keeping the final state
 * authoritative without a stale rAF resurrecting an older snapshot.
 *
 * Behavior:
 *   - `schedule()` is a no-op if a frame is already pending; the flush
 *     callback runs at most once per frame.
 *   - `cancel()` removes any pending handle (subsequent `schedule()` will
 *     queue a new one).
 *   - The pending handle is cleared *before* invoking the user flush so a
 *     flush that itself calls `schedule()` correctly enqueues the next frame.
 *
 * Fallback: when `requestAnimationFrame` is undefined (older test runners,
 * server-side rendering paths, etc.) the batcher uses `setTimeout(fn, 16)` to
 * approximate a frame. The two paths are wired through dedicated lookups so
 * that swapping globals via `vi.stubGlobal` in tests picks up the right
 * branch on each call.
 */

export type FlushFn = () => void;

export type RafBatcher = {
  /** Queue a flush for the next animation frame; no-op if already pending. */
  schedule(): void;
  /** Drop any pending flush. Safe to call when nothing is pending. */
  cancel(): void;
};

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

function resolveFrameApis(): { request: RequestFrame; cancel: CancelFrame } {
  const g = globalThis as typeof globalThis & {
    requestAnimationFrame?: RequestFrame;
    cancelAnimationFrame?: CancelFrame;
  };
  if (typeof g.requestAnimationFrame === "function") {
    const request = g.requestAnimationFrame.bind(g);
    const cancel: CancelFrame =
      typeof g.cancelAnimationFrame === "function"
        ? g.cancelAnimationFrame.bind(g)
        : () => {
            /* no-op when only request is polyfilled */
          };
    return { request, cancel };
  }
  // Fallback path: setTimeout at ~60Hz. The frame callback shape from
  // requestAnimationFrame receives a DOMHighResTimeStamp; we synthesize one
  // with `Date.now()` so the callback contract matches.
  const request: RequestFrame = (cb) =>
    (setTimeout(() => cb(Date.now()), 16) as unknown) as number;
  const cancel: CancelFrame = (handle) => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  };
  return { request, cancel };
}

export function createRafBatcher(flush: FlushFn): RafBatcher {
  let handle: number | null = null;

  const schedule: RafBatcher["schedule"] = () => {
    if (handle !== null) return;
    const { request } = resolveFrameApis();
    handle = request(() => {
      // Clear the handle BEFORE invoking the user flush so that a flush which
      // re-schedules itself successfully enqueues the next frame instead of
      // hitting the "already pending" guard above.
      handle = null;
      flush();
    });
  };

  const cancel: RafBatcher["cancel"] = () => {
    if (handle === null) return;
    const { cancel: cancelFrame } = resolveFrameApis();
    cancelFrame(handle);
    handle = null;
  };

  return { schedule, cancel };
}
