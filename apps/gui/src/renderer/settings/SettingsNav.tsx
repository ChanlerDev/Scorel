import type { ReactNode } from "react";

import {
  ChevronLeft,
  Monitor,
} from "../icons/index.js";
import type { GuiRelayDeviceView } from "../../shared/ipc.js";

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
  devices: GuiRelayDeviceView[];
  selectedDeviceKey: string;
  onSelect(id: string): void;
  onDeviceSelect(key: string): void;
  onBack(): void;
};

export function SettingsNav({ groups, active, devices, selectedDeviceKey, onSelect, onDeviceSelect, onBack }: SettingsNavProps) {
  const scopes = deviceScopes(devices);

  return (
    <aside className="settings-nav">
      <button type="button" className="settings-nav__back" onClick={onBack} aria-label="返回应用">
        <ChevronLeft size={14} />
        <span>返回应用</span>
      </button>
      <label className="settings-nav__scope">
        <Monitor />
        <select
          value={selectedDeviceKey}
          onChange={(event) => onDeviceSelect(event.currentTarget.value)}
          aria-label="配置设备"
        >
          {scopes.map((scope) => (
            <option key={scope.scopeKey} value={scope.scopeKey}>
              {scope.label}
            </option>
          ))}
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

type DeviceScope = {
  scopeKey: string;
  label: string;
};

const deviceScopes = (devices: GuiRelayDeviceView[]): DeviceScope[] => [
  { scopeKey: "local", label: "此电脑" },
  ...devices.map((device) => ({
    scopeKey: `relay:${device.deviceId}`,
    label: device.label,
  })),
];
