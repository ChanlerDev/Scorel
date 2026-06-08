/**
 * Animation-frame coalescer for high-frequency state changes (S0042/S0070).
 * Independent copy from `apps/webui/lib/events/delta-batch.ts`.
 */

export type FlushFn = () => void;

export type RafBatcher = {
  schedule(): void;
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
