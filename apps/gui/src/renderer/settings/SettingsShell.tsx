import { useState, type ReactNode } from "react";

import {
  Anchor,
  Box,
  Camera,
  Compass,
  GitBranch,
  Globe,
  Keyboard,
  Mouse,
  Server,
  Settings,
  Smile,
  Sun,
  User,
  Wallet,
} from "../icons/index.js";
import type { GuiRelayDeviceView } from "../../shared/ipc.js";
import { ConfigSection } from "./sections/ConfigSection.js";
import { GeneralSection } from "./sections/GeneralSection.js";
import { SectionPlaceholder } from "./sections/SectionPlaceholder.js";
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
    caption: "个人",
    items: [
      { id: "general", label: "常规", icon: <Settings size={14} /> },
      { id: "profile", label: "个人资料", icon: <User size={14} /> },
      { id: "appearance", label: "外观", icon: <Sun size={14} /> },
      { id: "config", label: "配置", icon: <Box size={14} /> },
      { id: "personalization", label: "个性化", icon: <Smile size={14} /> },
      { id: "keyboard", label: "键盘快捷键", icon: <Keyboard size={14} /> },
      { id: "usage", label: "使用情况和计费", icon: <Wallet size={14} /> },
    ],
  },
  {
    caption: "集成",
    items: [
      { id: "snapshot", label: "应用快照", icon: <Camera size={14} /> },
      { id: "mcp", label: "MCP 服务器", icon: <Server size={14} /> },
      { id: "browser", label: "浏览器", icon: <Compass size={14} /> },
      { id: "control", label: "电脑操控", icon: <Mouse size={14} /> },
    ],
  },
  {
    caption: "编码",
    items: [
      { id: "hooks", label: "钩子", icon: <Anchor size={14} /> },
      { id: "connections", label: "连接", icon: <Globe size={14} /> },
      { id: "git", label: "Git", icon: <GitBranch size={14} /> },
    ],
  },
];

export function SettingsShell(props: SettingsShellProps) {
  const [active, setActive] = useState<string>("config");

  let content: ReactNode = null;
  switch (active) {
    case "general":
      content = <GeneralSection />;
      break;
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
    case "profile":
      content = <SectionPlaceholder title="个人资料" />;
      break;
    case "appearance":
      content = <SectionPlaceholder title="外观" />;
      break;
    case "personalization":
      content = <SectionPlaceholder title="个性化" />;
      break;
    case "keyboard":
      content = <SectionPlaceholder title="键盘快捷键" />;
      break;
    case "usage":
      content = <SectionPlaceholder title="使用情况和计费" />;
      break;
    case "snapshot":
      content = <SectionPlaceholder title="应用快照" />;
      break;
    case "mcp":
      content = <SectionPlaceholder title="MCP 服务器" />;
      break;
    case "browser":
      content = <SectionPlaceholder title="浏览器" />;
      break;
    case "control":
      content = <SectionPlaceholder title="电脑操控" />;
      break;
    case "hooks":
      content = <SectionPlaceholder title="钩子" />;
      break;
    case "connections":
      content = <SectionPlaceholder title="连接" />;
      break;
    case "git":
      content = <SectionPlaceholder title="Git" />;
      break;
    default:
      content = <SectionPlaceholder title="未知" />;
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
