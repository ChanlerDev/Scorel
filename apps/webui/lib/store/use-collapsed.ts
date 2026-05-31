"use client";

// React hook over `lib/store/collapsed.ts` (S0044).
//
// Pattern: `useSyncExternalStore` against a module-scoped snapshot so every
// row that calls `useCollapsed(...)` re-renders when any other row toggles.
// We keep the snapshot itself stable across reads via a single shared
// reference; toggling produces a new map and broadcasts to all listeners.

import { useSyncExternalStore } from "react";

import { readCollapsed, writeCollapsed } from "./collapsed";

const listeners = new Set<() => void>();
let snapshot: Record<string, boolean> | null = null;

function getSnapshot(): Record<string, boolean> {
  if (snapshot === null) snapshot = readCollapsed();
  return snapshot;
}

function emit(): void {
  for (const listener of listeners) listener();
}

const SSR_SNAPSHOT: Record<string, boolean> = {};

export function useCollapsed(id: string): [boolean, () => void] {
  const map = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => getSnapshot(),
    () => SSR_SNAPSHOT,
  );
  const collapsed = Boolean(map[id]);
  const toggle = (): void => {
    const current = getSnapshot();
    const next = { ...current, [id]: !current[id] };
    snapshot = next;
    writeCollapsed(next);
    emit();
  };
  return [collapsed, toggle];
}

// Test seam: drop the cached snapshot so the next `getSnapshot` re-reads
// `localStorage`. Used by tests that clear storage between cases.
export function __resetCollapsedForTests(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}
