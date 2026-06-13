import type { ReactNode } from "react";

import {
  ChevronLeft,
  Monitor,
} from "../icons/index.js";
import type { GuiProjectView, GuiRelayDeviceView } from "../../shared/ipc.js";

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
  projects: GuiProjectView[];
  devices: GuiRelayDeviceView[];
  selectedProjectKey: string | null;
  onSelect(id: string): void;
  onProjectSelect(key: string): void;
  onBack(): void;
};

export function SettingsNav({ groups, active, projects, devices, selectedProjectKey, onSelect, onProjectSelect, onBack }: SettingsNavProps) {
  return (
    <aside className="settings-nav">
      <button type="button" className="settings-nav__back" onClick={onBack} aria-label="返回应用">
        <ChevronLeft size={14} />
        <span>返回应用</span>
      </button>
      <label className="settings-nav__scope">
        <Monitor />
        <select
          value={selectedProjectKey ?? ""}
          onChange={(event) => {
            if (event.currentTarget.value) onProjectSelect(event.currentTarget.value);
          }}
          aria-label="设置作用域"
        >
          {projects.length === 0 ? <option value="">没有项目</option> : null}
          {projects.map((project) => {
            const key = settingsProjectKey(project);
            return <option key={key} value={key}>{projectScopeLabel(project, devices)}</option>;
          })}
        </select>
      </label>
      <div className="settings-nav__scroll">
        {groups.map((group) => (
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

const settingsProjectKey = (project: GuiProjectView): string =>
  project.source === "local" ? `local:${project.projectId}` : `relay:${project.deviceId}:${project.projectId}`;

const projectScopeLabel = (project: GuiProjectView, devices: GuiRelayDeviceView[]): string => {
  if (project.source === "local") {
    return `此电脑 / ${project.displayName}`;
  }
  const device = devices.find((candidate) => candidate.deviceId === project.deviceId);
  return `${device?.label ?? project.deviceId} / ${project.displayName}`;
};
