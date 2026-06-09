import type { SessionSummary } from "@scorel/protocol";

import { ChevronDown, ChevronRight, Folder } from "../icons/index.js";
import type { GuiProjectView, GuiRelayDeviceView } from "../../shared/ipc.js";
import { useCollapsed } from "./use-collapsed.js";

export type ProjectTreeProps = {
  project: GuiProjectView;
  projectKey: string;
  isActive: boolean;
  relayDevice?: GuiRelayDeviceView;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onProjectClick(): void;
  onSessionClick(sessionId: string): void;
};

export function ProjectTree({
  project,
  projectKey,
  isActive,
  relayDevice,
  sessions,
  selectedSessionId,
  onProjectClick,
  onSessionClick,
}: ProjectTreeProps) {
  const { collapsed, toggle } = useCollapsed(`project:${projectKey}`, !isActive);

  const handleProjectClick = (): void => {
    toggle();
    onProjectClick();
  };

  const isRelay = project.source === "relay";
  const showSecondary = isRelay && relayDevice && relayDevice.label && relayDevice.label !== project.displayName;
  const onlinePillClass = isRelay
    ? `project-tree__online${relayDevice?.online ? "" : " project-tree__online--off"}`
    : null;

  return (
    <div className="project-tree">
      <button
        type="button"
        className={`project-tree__row${isActive ? " project-tree__row--active" : ""}`}
        onClick={handleProjectClick}
        title={project.displayName}
        data-testid={`project-row-${projectKey}`}
      >
        <span className="project-tree__caret">
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </span>
        <span className="project-tree__folder">
          <Folder />
        </span>
        <span className="project-tree__name">
          <span className="project-tree__name-primary">{project.displayName}</span>
          {showSecondary ? (
            <span className="project-tree__name-secondary">{relayDevice!.label}</span>
          ) : null}
        </span>
        {onlinePillClass ? <span className={onlinePillClass} /> : <span />}
      </button>
      {!collapsed ? (
        <ul className="project-tree__sessions" data-testid={`session-list-${projectKey}`}>
          {sessions.length === 0 ? (
            <li className="muted-row">暂无对话</li>
          ) : (
            sessions.map((session) => (
              <li key={session.sessionId}>
                <button
                  type="button"
                  className={`project-tree__session${
                    session.sessionId === selectedSessionId ? " project-tree__session--active" : ""
                  }`}
                  onClick={() => onSessionClick(session.sessionId)}
                  title={session.title ?? "Untitled session"}
                >
                  <span className="project-tree__session-title">
                    {session.title ?? "Untitled session"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
