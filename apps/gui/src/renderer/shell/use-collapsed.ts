import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "scorel.gui.collapsed";

type CollapseMap = Record<string, boolean>;

function readStore(): CollapseMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CollapseMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(map: CollapseMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function useCollapsed(key: string, defaultCollapsed = true): {
  collapsed: boolean;
  toggle(): void;
  setCollapsed(value: boolean): void;
} {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    const stored = readStore()[key];
    return typeof stored === "boolean" ? stored : defaultCollapsed;
  });

  const sync = useCallback((value: boolean) => {
    setCollapsedState(value);
    const map = readStore();
    map[key] = value;
    writeStore(map);
  }, [key]);

  // Re-read on key change so that switching active project picks up its
  // persisted collapse value.
  useEffect(() => {
    const stored = readStore()[key];
    if (typeof stored === "boolean") setCollapsedState(stored);
    else setCollapsedState(defaultCollapsed);
  }, [key, defaultCollapsed]);

  const toggle = useCallback(() => sync(!collapsed), [collapsed, sync]);

  return { collapsed, toggle, setCollapsed: sync };
}
