"use client";

// Pure-text ▸/▾ toggle (S0044). No icon dependency: a 1-character glyph in a
// fixed-width slot keeps spacing stable while a project/device row swings
// open or closed. Persistence + state live in `lib/store/use-collapsed.ts`.

import { useCollapsed } from "../../lib/store/use-collapsed";

export type CollapseToggleProps = {
  /** Stable synthetic id keyed into the collapse map (e.g. `device:<id>`). */
  id: string;
};

export function CollapseToggle({ id }: CollapseToggleProps): JSX.Element {
  const [collapsed, toggle] = useCollapsed(id);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand" : "Collapse"}
      data-testid="collapse-toggle"
      data-collapsed={collapsed ? "true" : "false"}
      className="inline-flex w-4 shrink-0 select-none items-center justify-center text-xs text-faint hover:text-text"
    >
      {collapsed ? "▸" : "▾"}
    </button>
  );
}
