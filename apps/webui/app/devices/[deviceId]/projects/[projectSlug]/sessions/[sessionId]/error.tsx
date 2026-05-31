"use client";

// Per-route error boundary for the session view (S0045 §4.3). Scoped to the
// `/devices/.../sessions/[sessionId]` segment so a render-time throw inside
// the chatbox does not bubble up to the global boundary; the user can hit
// `重新加载` to remount the segment without losing sidebar state.

import { useEffect } from "react";

export default function SessionRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[scorel] session route error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="greeting">出错了</h1>
      <p className="text-md text-muted">
        发生意外错误。已记录到控制台。
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-pill bg-accent px-5 py-2 text-bg hover:bg-accent-hover"
      >
        重新加载
      </button>
    </div>
  );
}
