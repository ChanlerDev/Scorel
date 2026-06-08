import type { ReactNode } from "react";

import type { Turn } from "../chatbox/projector.js";
import type { GuiProjectView } from "../../shared/ipc.js";
import { EmptyState } from "./EmptyState.js";
import { SessionView } from "./SessionView.js";
import { Topbar } from "./Topbar.js";

export type WorkspaceProps = {
  selectedProject: GuiProjectView | undefined;
  selectedSessionTitle: string | undefined;
  hasActiveSession: boolean;
  turns: Turn[];
  message: string;
  onMessageChange(value: string): void;
  onSubmit(): void;
  busy: boolean;
  inFlight: boolean;
  error: string | null;
  hostMessage: string | undefined;
  onPickerOpen(anchor: DOMRect): void;
  picker?: ReactNode;
};

export function Workspace(props: WorkspaceProps) {
  return (
    <main className="workspace">
      <Topbar
        title={props.hasActiveSession ? props.selectedSessionTitle : undefined}
        error={props.error ?? undefined}
        hostMessage={props.hostMessage}
      />
      {props.hasActiveSession ? (
        <SessionView
          selectedProject={props.selectedProject}
          turns={props.turns}
          message={props.message}
          onMessageChange={props.onMessageChange}
          onSubmit={props.onSubmit}
          onPickerOpen={props.onPickerOpen}
          busy={props.busy}
          inFlight={props.inFlight}
          picker={props.picker}
        />
      ) : (
        <EmptyState
          selectedProject={props.selectedProject}
          message={props.message}
          onMessageChange={props.onMessageChange}
          onSubmit={props.onSubmit}
          onPickerOpen={props.onPickerOpen}
          busy={props.busy}
          inFlight={props.inFlight}
          picker={props.picker}
        />
      )}
    </main>
  );
}
