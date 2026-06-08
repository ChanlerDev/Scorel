import { useState, type ReactNode } from "react";

import {
  Box,
} from "../icons/index.js";
import type { GuiRelayDeviceView } from "../../shared/ipc.js";
import { ConfigSection } from "./sections/ConfigSection.js";
import { SettingsNav, type SettingsNavGroup } from "./SettingsNav.js";

export type SettingsShellProps = {
  devices: GuiRelayDeviceView[];
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
  onBack(): void;
};

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    caption: "设置",
    items: [
      { id: "config", label: "配置", icon: <Box size={14} /> },
    ],
  },
];

export function SettingsShell(props: SettingsShellProps) {
  const [active, setActive] = useState<string>("config");

  let content: ReactNode = null;
  switch (active) {
    case "config":
      content = (
        <ConfigSection
          devices={props.devices}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          refresh={props.refresh}
        />
      );
      break;
    default:
      content = null;
  }

  return (
    <div className="settings-shell">
      <SettingsNav
        groups={NAV_GROUPS}
        active={active}
        onSelect={setActive}
        onBack={props.onBack}
      />
      <main className="settings-main">{content}</main>
    </div>
  );
}
