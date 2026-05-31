"use client";

// Global Next.js App Router error boundary (S0045 §4.3). Catches anything
// that escapes a per-route segment boundary so the user gets a graceful
// recover-or-reload card instead of the dev-mode red overlay. Console log
// preserves the stack for diagnosis.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[scorel] unhandled UI error:", error);
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
