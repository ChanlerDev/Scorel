import { Component, useState, type ErrorInfo, type ReactNode } from "react";

import {
  Activity,
  Box,
  FileText,
  Server,
  Smartphone,
  Terminal,
  Puzzle,
} from "../icons/index.js";
import type { GuiDeviceRef, GuiExtensionSettingsView, GuiMemorySettingsView, GuiMemoryStatusView, GuiModelProfileView, GuiObservabilitySettingsView, GuiRelayDeviceView, GuiRuntimeSettingsView, GuiTaskBudgetSettingsView } from "../../shared/ipc.js";
import { BudgetSection } from "./sections/BudgetSection.js";
import { ConfigSection } from "./sections/ConfigSection.js";
import { ImSection } from "./sections/ImSection.js";
import { McpSection } from "./sections/McpSection.js";
import { MemorySection } from "./sections/MemorySection.js";
import { ModelSection } from "./sections/ModelSection.js";
import { ObservabilitySection } from "./sections/ObservabilitySection.js";
import { ProviderSection } from "./sections/ProviderSection.js";
import { RuntimeSection } from "./sections/RuntimeSection.js";
import { SettingsNav, type SettingsNavGroup } from "./SettingsNav.js";

export type SettingsShellProps = {
  devices: GuiRelayDeviceView[];
  selectedDeviceKey: string;
  device: GuiDeviceRef;
  modelProfile: GuiModelProfileView;
  memory: GuiMemorySettingsView;
  memoryStatus: GuiMemoryStatusView;
  runtime: GuiRuntimeSettingsView;
  taskBudget: GuiTaskBudgetSettingsView;
  observability: GuiObservabilitySettingsView;
  imExtensions: Record<string, GuiExtensionSettingsView>;
  onModelProfileChange(profile: GuiModelProfileView): void;
  onMemoryChange(memory: GuiMemorySettingsView): void;
  onRuntimeChange(runtime: GuiRuntimeSettingsView): void;
  onTaskBudgetChange(taskBudget: GuiTaskBudgetSettingsView): void;
  onObservabilityChange(observability: GuiObservabilitySettingsView): void;
  onExtensionChange(extension: GuiExtensionSettingsView): void;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
  onDeviceSelect(key: string): void;
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
      { id: "budget", label: "任务预算", icon: <Activity size={14} /> },
      { id: "observability", label: "可观测性", icon: <Activity size={14} /> },
      { id: "im", label: "IM", icon: <Smartphone size={14} /> },
      { id: "mcp", label: "MCP", icon: <Puzzle size={14} /> },
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
          device={props.device}
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
          device={props.device}
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
          device={props.device}
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
          device={props.device}
          runtime={props.runtime}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onRuntimeChange={props.onRuntimeChange}
        />
      );
      break;
    case "observability":
      content = (
        <ObservabilitySection
          device={props.device}
          observability={props.observability}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onObservabilityChange={props.onObservabilityChange}
        />
      );
      break;
    case "budget":
      content = (
        <BudgetSection
          device={props.device}
          taskBudget={props.taskBudget}
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          onTaskBudgetChange={props.onTaskBudgetChange}
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
    case "mcp":
      content = (
        <McpSection
          busy={props.busy}
          setBusy={props.setBusy}
          setError={props.setError}
          refresh={props.refresh}
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
        devices={props.devices}
        selectedDeviceKey={props.selectedDeviceKey}
        onSelect={setActive}
        onDeviceSelect={props.onDeviceSelect}
        onBack={props.onBack}
      />
      <main className="settings-main">
        <SettingsErrorBoundary resetKey={`${active}:${props.selectedDeviceKey}`}>
          {content}
        </SettingsErrorBoundary>
      </main>
    </div>
  );
}

class SettingsErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { message: string | null; resetKey: string }> {
  constructor(props: { children: ReactNode; resetKey: string }) {
    super(props);
    this.state = { message: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(cause: unknown): { message: string } {
    return { message: cause instanceof Error ? cause.message : String(cause) };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { message: string | null; resetKey: string },
  ): { message: null; resetKey: string } | null {
    if (props.resetKey === state.resetKey) return null;
    return { message: null, resetKey: props.resetKey };
  }

  override componentDidCatch(cause: Error, info: ErrorInfo): void {
    console.error("Settings render error", cause, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.message) return this.props.children;
    return (
      <section className="settings-section settings-section--wide">
        <div className="settings-card">
          <div className="settings-empty">设置页面渲染失败：{this.state.message}</div>
        </div>
      </section>
    );
  }
}
