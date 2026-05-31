// Persistence helpers for the sidebar's per-node collapse map (S0044).
//
// One global key holds an `id → collapsed` record so device / project tree
// nodes can persist their ▸/▾ state across page reloads. The shape stays
// flat (no nesting) because every visible row carries a unique synthetic id
// (e.g. `device:<id>` / `project:<deviceId>/<slug>`); namespacing happens at
// the call site, not in storage.
//
// Note on boundary: the WebUI's `localStorage` policy (boundary test)
// requires every direct `localStorage` reference to live under
// `lib/store/`. This module is the dedicated reader/writer for the
// collapse map; consumers go through `use-collapsed.ts`.

const KEY = "scorel.ui.collapsed";

export function readCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Normalize: only keep boolean values; ignore any non-boolean noise.
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeCollapsed(next: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota / disabled storage — silently swallow; collapse state is best
    // effort UI persistence, not authoritative data.
  }
}
