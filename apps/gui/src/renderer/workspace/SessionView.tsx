import type { ReactNode } from "react";

import { Composer } from "../composer/Composer.js";
import { ProjectPickerPill } from "../composer/ProjectPickerPill.js";
import { Transcript } from "../chatbox/Transcript.js";
import type { Turn } from "../chatbox/projector.js";
import type { GuiProjectView } from "../../shared/ipc.js";

export type SessionViewProps = {
  selectedProject: GuiProjectView | undefined;
  turns: Turn[];
  message: string;
  onMessageChange(value: string): void;
  onSubmit(): void;
  onPickerOpen(): void;
  busy: boolean;
  inFlight: boolean;
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
