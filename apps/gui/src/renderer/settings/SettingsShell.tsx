import { useState, type ReactNode } from "react";

import {
  Box,
  FileText,
  Server,
  Smartphone,
} from "../icons/index.js";
import type { GuiExtensionSettingsView, GuiMemorySettingsView, GuiMemoryStatusView, GuiModelProfileView, GuiProjectRef, GuiRelayDeviceView } from "../../shared/ipc.js";
import { ConfigSection } from "./sections/ConfigSection.js";
import { ImSection } from "./sections/ImSection.js";
import { MemorySection } from "./sections/MemorySection.js";
import { ModelSection } from "./sections/ModelSection.js";
import { ProviderSection } from "./sections/ProviderSection.js";
import { SettingsNav, type SettingsNavGroup } from "./SettingsNav.js";

export type SettingsShellProps = {
  devices: GuiRelayDeviceView[];
  project: GuiProjectRef | null;
  modelProfile: GuiModelProfileView;
  memory: GuiMemorySettingsView;
  memoryStatus: GuiMemoryStatusView;
  telegram: GuiExtensionSettingsView;
  onModelProfileChange(profile: GuiModelProfileView): void;
  onMemoryChange(memory: GuiMemorySettingsView): void;
  onTelegramChange(extension: GuiExtensionSettingsView): void;
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
      { id: "memory", label: "记忆", icon: <FileText size={14} /> },
      { id: "im", label: "IM", icon: <Smartphone size={14} /> },
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
    case "memory":
      content = (
        <MemorySection
          project={props.project}
          memory={props.memory}
          status={props.memoryStatus}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onMemoryChange={props.onMemoryChange}
        />
      );
      break;
    case "im":
      content = (
        <ImSection
          telegram={props.telegram}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onTelegramChange={props.onTelegramChange}
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
