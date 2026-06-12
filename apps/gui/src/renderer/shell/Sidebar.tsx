import type { SessionSummary } from "@scorel/protocol";
import type { MouseEvent } from "react";

import {
  PanelLeft,
  Plus,
  Settings,
} from "../icons/index.js";
import { ProjectPickerPill } from "../composer/ProjectPickerPill.js";
import type { GuiProjectView, GuiRelayDeviceView } from "../../shared/ipc.js";
import { ProjectTree } from "./ProjectTree.js";
import { SidebarActionRow } from "./SidebarActionRow.js";

export type SidebarProps = {
  projects: GuiProjectView[];
  selectedProjectKey: string | null;
  selectedSessionId: string | null;
  relayDevices: GuiRelayDeviceView[];
  sessionsByProject: Record<string, SessionSummary[]>;
  busy: boolean;
  onNewSessionClick(): void;
  onProjectPickerOpen(anchor: DOMRect): void;
  onProjectClick(key: string): void;
  onProjectExpanded(key: string): void;
  onSessionClick(key: string, sessionId: string): void;
  onSettingsClick(): void;
  onSidebarToggle?: () => void;
  onResizeStart?(event: MouseEvent<HTMLDivElement>): void;
};

export function projectKey(project: GuiProjectView): string {
  return project.source === "local"
    ? `local:${project.projectId}`
    : `relay:${project.deviceId}:${project.projectId}`;
}

export function Sidebar({
  projects,
  selectedProjectKey,
  selectedSessionId,
  relayDevices,
  sessionsByProject,
  busy,
  onNewSessionClick,
  onProjectPickerOpen,
  onProjectClick,
  onProjectExpanded,
  onSessionClick,
  onSettingsClick,
  onSidebarToggle,
  onResizeStart,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__traffic">
        {onSidebarToggle ? (
          <button
            type="button"
            className="sidebar__toggle"
            aria-label="收起侧边栏"
            title="收起侧边栏"
            onClick={onSidebarToggle}
            data-testid="sidebar-toggle"
          >
            <PanelLeft size={15} />
          </button>
        ) : null}
      </div>
      <nav className="sidebar__actions">
        <SidebarActionRow
          icon={<Plus size={14} />}
          label="新对话"
          disabled={busy}
          onClick={onNewSessionClick}
          testId="sidebar-new-session"
        />
      </nav>
      <div className="sidebar__scroll">
        <div className="sidebar__section-header">
          <h2 className="sidebar__section-title">项目</h2>
          <ProjectPickerPill
            label="添加项目"
            onClick={onProjectPickerOpen}
            disabled={busy}
            className="project-picker-pill--sidebar"
            testId="sidebar-add-project"
          />
        </div>
        {projects.length === 0 ? (
          <div className="muted-row">还没有项目</div>
        ) : (
          <ul className="sidebar__list" data-testid="project-list">
            {projects.map((project) => {
              const key = projectKey(project);
              const relayDevice = project.source === "relay"
                ? relayDevices.find((device) => device.deviceId === project.deviceId)
                : undefined;
              return (
                <li key={key}>
                  <ProjectTree
                    project={project}
                    projectKey={key}
                    isActive={key === selectedProjectKey}
                    relayDevice={relayDevice}
                    sessions={sessionsByProject[key] ?? []}
                    selectedSessionId={key === selectedProjectKey ? selectedSessionId : null}
                    onProjectClick={() => onProjectClick(key)}
                    onProjectExpanded={onProjectExpanded}
                    onSessionClick={(sessionId) => onSessionClick(key, sessionId)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="sidebar__bottom">
        <SidebarActionRow
          icon={<Settings size={14} />}
          label="设置"
          onClick={onSettingsClick}
          testId="sidebar-open-settings"
        />
      </div>
      <div
        className="sidebar__resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        onMouseDown={onResizeStart}
        data-testid="sidebar-resize-handle"
      />
    </aside>
  );
}
