import { useState, type ReactNode } from "react";

import {
  ChevronDown,
  ChevronLeft,
  Monitor,
  Search,
} from "../icons/index.js";

export type SettingsNavGroup = {
  caption: string;
  items: SettingsNavItem[];
};

export type SettingsNavItem = {
  id: string;
  label: string;
  icon: ReactNode;
};

export type SettingsNavProps = {
  groups: SettingsNavGroup[];
  active: string;
  onSelect(id: string): void;
  onBack(): void;
};

export function SettingsNav({ groups, active, onSelect, onBack }: SettingsNavProps) {
  const [query, setQuery] = useState<string>("");
  const lower = query.trim().toLowerCase();
  const filteredGroups = lower
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.label.toLowerCase().includes(lower)),
        }))
        .filter((group) => group.items.length > 0)
    : groups;

  return (
    <aside className="settings-nav">
      <button type="button" className="settings-nav__back" onClick={onBack} aria-label="返回应用">
        <ChevronLeft size={14} />
        <span>返回应用</span>
      </button>
      <div className="settings-nav__device" aria-disabled="true">
        <Monitor />
        <span>此电脑</span>
        <ChevronDown size={12} />
      </div>
      <div className="settings-nav__search">
        <Search />
        <input
          placeholder="搜索设置..."
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="settings-nav__scroll">
        {filteredGroups.map((group) => (
          <div key={group.caption}>
            <div className="settings-nav__caption">{group.caption}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav__item${active === item.id ? " settings-nav__item--active" : ""}`}
                onClick={() => onSelect(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
