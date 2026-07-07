import type { MouseEvent, ReactNode } from "react";

import { Composer } from "../composer/Composer.js";
import type { ComposerContextUsage } from "../composer/Composer.js";
import { ProjectPickerPill } from "../composer/ProjectPickerPill.js";
import type { GuiProjectView, GuiModelProfileView } from "../../shared/ipc.js";

export type EmptyStateProps = {
  selectedProject: GuiProjectView | undefined;
  message: string;
  onMessageChange(value: string): void;
  onSubmit(): void;
  onPickerOpen(anchor: DOMRect): void;
  busy: boolean;
  inFlight: boolean;
  models: GuiModelProfileView["models"];
  selectedModelId: string;
  onModelChange(modelId: string): void;
  modelPickerDisabled?: boolean;
  contextUsage?: ComposerContextUsage;
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
  models,
  selectedModelId,
  onModelChange,
  modelPickerDisabled,
  contextUsage,
  picker,
}: EmptyStateProps) {
  const projectName = selectedProject?.displayName;
  const handleHeadingProjectClick = (event: MouseEvent<HTMLButtonElement>): void => {
    onPickerOpen(event.currentTarget.getBoundingClientRect());
  };

  return (
    <section className="content empty">
      <div className="empty__stack">
        <h1 className="empty__title">
          {projectName ? (
            <>
              我们应该在{" "}
              <button
                type="button"
                className="empty__project-button"
                onClick={handleHeadingProjectClick}
                disabled={busy}
                data-testid="empty-heading-project-picker"
              >
                {projectName}
              </button>{" "}
              中构建什么？
            </>
          ) : (
            "我们要构建什么？"
          )}
        </h1>
        <div className="composer-shell">
          <Composer
            value={message}
            onChange={onMessageChange}
            onSubmit={onSubmit}
            disabled={busy}
            inFlight={inFlight}
            models={models}
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
            modelPickerDisabled={modelPickerDisabled}
            contextUsage={contextUsage}
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
