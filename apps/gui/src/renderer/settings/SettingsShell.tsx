import { useState, type ReactNode } from "react";

import {
  Box,
  FileText,
  Server,
  Smartphone,
  Terminal,
} from "../icons/index.js";
import type { GuiExtensionSettingsView, GuiMemorySettingsView, GuiMemoryStatusView, GuiModelProfileView, GuiProjectRef, GuiProjectView, GuiRelayDeviceView, GuiRuntimeSettingsView } from "../../shared/ipc.js";
import { ConfigSection } from "./sections/ConfigSection.js";
import { ImSection } from "./sections/ImSection.js";
import { MemorySection } from "./sections/MemorySection.js";
import { ModelSection } from "./sections/ModelSection.js";
import { ProviderSection } from "./sections/ProviderSection.js";
import { RuntimeSection } from "./sections/RuntimeSection.js";
import { SettingsNav, type SettingsNavGroup } from "./SettingsNav.js";

export type SettingsShellProps = {
  devices: GuiRelayDeviceView[];
  projects: GuiProjectView[];
  selectedProjectKey: string | null;
  project: GuiProjectRef | null;
  modelProfile: GuiModelProfileView;
  memory: GuiMemorySettingsView;
  memoryStatus: GuiMemoryStatusView;
  runtime: GuiRuntimeSettingsView;
  imExtensions: Record<string, GuiExtensionSettingsView>;
  onModelProfileChange(profile: GuiModelProfileView): void;
  onMemoryChange(memory: GuiMemorySettingsView): void;
  onRuntimeChange(runtime: GuiRuntimeSettingsView): void;
  onExtensionChange(extension: GuiExtensionSettingsView): void;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
  onProjectSelect(key: string): void;
  onBack(): void;
};

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    caption: "设置",
    items: [
      { id: "model", label: "模型", icon: <Box size={14} /> },
      { id: "provider", label: "Provider", icon: <Box size={14} /> },
      { id: "memory", label: "记忆", icon: <FileText size={14} /> },
      { id: "runtime", label: "Token 节省", icon: <Terminal size={14} /> },
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
    case "runtime":
      content = (
        <RuntimeSection
          project={props.project}
          runtime={props.runtime}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onRuntimeChange={props.onRuntimeChange}
        />
      );
      break;
    case "im":
      content = (
        <ImSection
          extensions={props.imExtensions}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onExtensionChange={props.onExtensionChange}
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
        projects={props.projects}
        devices={props.devices}
        selectedProjectKey={props.selectedProjectKey}
        onSelect={setActive}
        onProjectSelect={props.onProjectSelect}
        onBack={props.onBack}
      />
      <main className="settings-main">{content}</main>
    </div>
  );
}
