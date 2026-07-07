import type { ReactNode } from "react";

import { Composer } from "../composer/Composer.js";
import type { ComposerContextUsage } from "../composer/Composer.js";
import { ProjectPickerPill } from "../composer/ProjectPickerPill.js";
import { Transcript } from "../chatbox/Transcript.js";
import type { Turn } from "../chatbox/projector.js";
import type { GuiProjectView, GuiModelProfileView } from "../../shared/ipc.js";

export type SessionViewProps = {
  selectedProject: GuiProjectView | undefined;
  turns: Turn[];
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

export function SessionView({
  selectedProject,
  turns,
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
}: SessionViewProps) {
  return (
    <section className="content session-view">
      <Transcript turns={turns} />
      <div className="composer-shell">
        <Composer
          value={message}
          onChange={onMessageChange}
          onSubmit={onSubmit}
          disabled={busy || !selectedProject}
          inFlight={inFlight}
          models={models}
          selectedModelId={selectedModelId}
          onModelChange={onModelChange}
          modelPickerDisabled={modelPickerDisabled}
          contextUsage={contextUsage}
        />
        <ProjectPickerPill
          label={selectedProject?.displayName ?? "选择项目"}
          onClick={onPickerOpen}
          disabled={busy}
        />
      </div>
      {picker}
    </section>
  );
}
