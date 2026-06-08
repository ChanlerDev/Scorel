import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChevronDown } from "../icons/index.js";

export type AutoscrollRegionProps = {
  children: ReactNode;
  tickKey?: number | string;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function safeScrollIntoView(node: HTMLElement): void {
  if (typeof node.scrollIntoView !== "function") return;
  try {
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "end",
    });
  } catch {
    try {
      node.scrollIntoView();
    } catch {
      /* swallow */
    }
  }
}

export function AutoscrollRegion({ children, tickKey }: AutoscrollRegionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sentinel = sentinelRef.current;
    const meaningful = Array.from(container.children).filter((child) => child !== sentinel);
    setHasContent(meaningful.length > 0);
  }, [children]);

  useEffect(() => {
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;
    if (typeof IntersectionObserver === "undefined") {
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
      { root: container, rootMargin: "0px 0px 32px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

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
    <div className="transcript-region">
      <div
        ref={containerRef}
        className="transcript"
        data-at-bottom={isAtBottom ? "true" : "false"}
      >
        {children}
        <div ref={sentinelRef} aria-hidden="true" className="transcript__sentinel" />
      </div>
      {!isAtBottom && hasContent ? (
        <button type="button" className="jump-to-bottom" onClick={handleJump} aria-label="Jump to bottom">
          <ChevronDown size={18} />
        </button>
      ) : null}
    </div>
  );
}
