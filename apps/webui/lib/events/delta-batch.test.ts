import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRafBatcher } from "./delta-batch";

describe("createRafBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces multiple schedules into a single flush per frame (rAF path)", () => {
    type Frame = (ts: number) => void;
    const queue: Frame[] = [];
    let nextHandle = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: Frame) => {
      queue.push(cb);
      nextHandle += 1;
      return nextHandle;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      queue.length = 0;
    });

    const flush = vi.fn();
    const batcher = createRafBatcher(flush);

    batcher.schedule();
    batcher.schedule();
    batcher.schedule();
    expect(queue.length).toBe(1);
    expect(flush).not.toHaveBeenCalled();

    // Run the queued frame.
    queue.shift()?.(0);
    expect(flush).toHaveBeenCalledTimes(1);

    // After the flush fires, schedule again — handle was cleared, so a fresh
    // frame is queued.
    batcher.schedule();
    expect(queue.length).toBe(1);
    queue.shift()?.(0);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("cancel() prevents the queued flush from firing", () => {
    const queue: Array<(ts: number) => void> = [];
    const cancelHandles: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (ts: number) => void) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      cancelHandles.push(handle);
      // Drop the queued callback so a stray flush cannot run later.
      queue.length = 0;
    });

    const flush = vi.fn();
    const batcher = createRafBatcher(flush);
    batcher.schedule();
    batcher.cancel();
    expect(cancelHandles).toEqual([1]);

    // Even if a frame somehow fired (it shouldn't), the queue is empty.
    expect(queue.length).toBe(0);
    expect(flush).not.toHaveBeenCalled();

    // After cancel, schedule again to confirm the batcher is reusable.
    batcher.schedule();
    expect(queue.length).toBe(1);
  });

  it("clears the pending handle BEFORE invoking flush so a flush that re-schedules works", () => {
    const queue: Array<(ts: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (ts: number) => void) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      queue.length = 0;
    });

    let runs = 0;
    const batcher = createRafBatcher(() => {
      runs += 1;
      // Flush requests another frame from inside the callback. The batcher
      // must have cleared its pending handle by now or this becomes a no-op
      // and the second frame is silently dropped.
      if (runs < 3) batcher.schedule();
    });

    batcher.schedule();
    expect(queue.length).toBe(1);
    queue.shift()?.(0);
    expect(runs).toBe(1);
    expect(queue.length).toBe(1);
    queue.shift()?.(0);
    expect(runs).toBe(2);
    queue.shift()?.(0);
    expect(runs).toBe(3);
  });

  it("falls back to setTimeout(16) when requestAnimationFrame is undefined", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);

    const flush = vi.fn();
    const batcher = createRafBatcher(flush);
    batcher.schedule();
    // setTimeout should be queued; a redundant schedule is a no-op.
    batcher.schedule();
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("setTimeout fallback respects cancel", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    const flush = vi.fn();
    const batcher = createRafBatcher(flush);
    batcher.schedule();
    batcher.cancel();
    vi.advanceTimersByTime(50);
    expect(flush).not.toHaveBeenCalled();
  });
});
