import { useState, type ReactNode } from "react";

import {
  Box,
  Server,
} from "../icons/index.js";
import type { GuiModelProfileView, GuiProjectRef, GuiRelayDeviceView } from "../../shared/ipc.js";
import { ConfigSection } from "./sections/ConfigSection.js";
import { ModelSection } from "./sections/ModelSection.js";
import { ProviderSection } from "./sections/ProviderSection.js";
import { SettingsNav, type SettingsNavGroup } from "./SettingsNav.js";

export type SettingsShellProps = {
  devices: GuiRelayDeviceView[];
  project: GuiProjectRef | null;
  modelProfile: GuiModelProfileView;
  onModelProfileChange(profile: GuiModelProfileView): void;
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
      { id: "model", label: "模型", icon: <Box size={14} /> },
      { id: "provider", label: "Provider", icon: <Box size={14} /> },
      { id: "connections", label: "连接", icon: <Server size={14} /> },
    ],
  },
];

export function SettingsShell(props: SettingsShellProps) {
  const [active, setActive] = useState<string>("model");

  let content: ReactNode = null;
  switch (active) {
    case "model":
      content = (
        <ModelSection
          project={props.project}
          modelProfile={props.modelProfile}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onModelProfileChange={props.onModelProfileChange}
        />
      );
      break;
    case "provider":
      content = (
        <ProviderSection
          project={props.project}
          modelProfile={props.modelProfile}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onModelProfileChange={props.onModelProfileChange}
        />
      );
      break;
    case "connections":
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
