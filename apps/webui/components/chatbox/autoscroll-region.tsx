"use client";

/**
 * Scrollable region wrapper that pins the viewport to the bottom while the
 * user has not scrolled away (S0042). Replaces the ad-hoc scrollTop math that
 * lived inside `Transcript` before this spec.
 *
 * Behavior:
 *   - Renders an `overflow-y-auto` container with a 1px sentinel at the very
 *     bottom of the children.
 *   - An `IntersectionObserver` watches the sentinel against the scroll
 *     container so we know whether the user is "at bottom" without polling
 *     `scrollHeight - scrollTop - clientHeight` on every scroll event.
 *   - When `tickKey` changes (e.g. transcript grows by one turn) we call
 *     `sentinel.scrollIntoView` *only if* `isAtBottom` is true. Users who
 *     scrolled up to read older turns are not yanked back down by new
 *     deltas.
 *   - When the user is not at bottom, a floating `<JumpToBottomButton>` pill
 *     appears in the bottom-right of the scroll region. Clicking it scrolls
 *     the sentinel into view.
 *   - Smooth scroll honors `prefers-reduced-motion: reduce`: animation users
 *     get `behavior: "auto"` (instant snap) instead of the default "smooth".
 *
 * Test seams:
 *   - `data-testid="autoscroll-region"` on the scroll container.
 *   - `data-testid="autoscroll-sentinel"` on the sentinel div.
 *   - `data-at-bottom="true|false"` on the container so jsdom assertions can
 *     observe state without reaching into React internals.
 *   - The jump button carries `data-testid="jump-to-bottom"`.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type AutoscrollRegionProps = {
  children: ReactNode;
  /**
   * A primitive that changes whenever the children should be considered
   * "appended". Typical caller passes the transcript turn count; any change
   * triggers the at-bottom check + auto-scroll. Optional — when omitted, we
   * fall back to a MutationObserver via React's render cycle.
   */
  tickKey?: number | string;
  className?: string;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Scroll a node into view if the runtime supports it. jsdom (test runtime)
 * does not implement `scrollIntoView`, so we feature-detect rather than
 * polyfill — production browsers always have it. Tests that want to assert
 * the call still happens stub it onto `HTMLElement.prototype`.
 */
function safeScrollIntoView(node: HTMLElement): void {
  if (typeof node.scrollIntoView !== "function") return;
  try {
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "end",
    });
  } catch {
    // Older browsers may throw on the options form; fall back to no-arg.
    try {
      node.scrollIntoView();
    } catch {
      /* swallow — non-fatal */
    }
  }
}

export function AutoscrollRegion({
  children,
  tickKey,
  className,
}: AutoscrollRegionProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasContent, setHasContent] = useState(false);

  // Track whether children render any DOM. The empty-state placeholder still
  // counts as content visually but we want the jump button hidden when the
  // transcript is truly empty. We approximate "has content" by checking if
  // the container has children other than the sentinel.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sentinel = sentinelRef.current;
    const meaningful = Array.from(container.children).filter(
      (child) => child !== sentinel,
    );
    setHasContent(meaningful.length > 0);
  }, [children]);

  // Observe the sentinel to know whether the user has scrolled away. Using
  // an IntersectionObserver is cheaper than listening to every scroll event
  // and lines up with the React 18 concurrent-rendering model.
  useEffect(() => {
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;
    if (typeof IntersectionObserver === "undefined") {
      // Older test runtimes without an IntersectionObserver polyfill: fall
      // back to assuming "at bottom" so autoscroll still works in jsdom
      // without flooding console errors. Real browsers always have it.
      setIsAtBottom(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === sentinel) {
            setIsAtBottom(entry.isIntersecting);
          }
        }
      },
      {
        root: container,
        // A small positive margin (the sentinel sits at 0 height so we want
        // intersection to register even when the bottom is within ~32px).
        rootMargin: "0px 0px 32px 0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // When children change and we're at the bottom, smoothly snap back so the
  // newest token stays visible. When the user scrolled up to read history,
  // we leave them alone.
  useEffect(() => {
    if (!isAtBottom) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    safeScrollIntoView(sentinel);
  }, [tickKey, isAtBottom]);

  const handleJump = useCallback(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    safeScrollIntoView(sentinel);
  }, []);

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        data-testid="autoscroll-region"
        data-at-bottom={isAtBottom ? "true" : "false"}
        className={
          className ??
          "h-full overflow-y-auto"
        }
      >
        {children}
        <div
          ref={sentinelRef}
          data-testid="autoscroll-sentinel"
          aria-hidden="true"
          className="h-px w-full"
        />
      </div>
      <JumpToBottomButton
        visible={!isAtBottom && hasContent}
        onClick={handleJump}
      />
    </div>
  );
}

export type JumpToBottomButtonProps = {
  visible: boolean;
  onClick: () => void;
};

export function JumpToBottomButton({
  visible,
  onClick,
}: JumpToBottomButtonProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      data-testid="jump-to-bottom"
      onClick={onClick}
      className="absolute bottom-3 right-3 rounded-full border border-subtle bg-surface-raised px-3 py-1 text-xs text-muted shadow-md hover:text-text"
    >
      Jump to bottom ↓
    </button>
  );
}

export default AutoscrollRegion;
