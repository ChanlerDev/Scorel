import type { ReactNode } from "react";

import { Composer } from "../composer/Composer.js";
import { ProjectPickerPill } from "../composer/ProjectPickerPill.js";
import type { GuiProjectView } from "../../shared/ipc.js";

export type EmptyStateProps = {
  selectedProject: GuiProjectView | undefined;
  message: string;
  onMessageChange(value: string): void;
  onSubmit(): void;
  onPickerOpen(): void;
  busy: boolean;
  inFlight: boolean;
  picker?: ReactNode;
};

export function EmptyState({
  selectedProject,
  message,
  onMessageChange,
  onSubmit,
  onPickerOpen,
  busy,
  inFlight,
  picker,
}: EmptyStateProps) {
  const projectName = selectedProject?.displayName;
  const heading = projectName
    ? `我们应该在 ${projectName} 中做些什么？`
    : "我们应该构建什么？";
  return (
    <section className="content empty">
      <div className="empty__stack">
        <h1 className="empty__title">{heading}</h1>
        <div className="composer-shell">
          <Composer
            value={message}
            onChange={onMessageChange}
            onSubmit={onSubmit}
            disabled={busy || !selectedProject}
            inFlight={inFlight}
          />
          <ProjectPickerPill
            label={projectName ?? "选择项目"}
            onClick={onPickerOpen}
            disabled={busy}
          />
        </div>
        {picker}
      </div>
    </section>
  );
}
