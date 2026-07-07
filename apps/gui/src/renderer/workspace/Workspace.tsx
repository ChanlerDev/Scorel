import type { ReactNode } from "react";

import type { Turn } from "../chatbox/projector.js";
import type { ComposerContextUsage } from "../composer/Composer.js";
import type { GuiProjectView, GuiModelProfileView } from "../../shared/ipc.js";
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
  models: GuiModelProfileView["models"];
  selectedModelId: string;
  onModelChange(modelId: string): void;
  modelPickerDisabled?: boolean;
  contextUsage?: ComposerContextUsage;
  error: string | null;
  hostMessage: string | undefined;
  onPickerOpen(anchor: DOMRect): void;
  sidebarCollapsed?: boolean;
  onSidebarToggle?: () => void;
  picker?: ReactNode;
};

export function Workspace(props: WorkspaceProps) {
  const showTopbar =
    props.hasActiveSession ||
    Boolean(props.error) ||
    Boolean(props.hostMessage) ||
    Boolean(props.sidebarCollapsed);

  return (
    <main className={`workspace${showTopbar ? "" : " workspace--no-topbar"}`}>
      {showTopbar ? (
        <Topbar
          title={props.hasActiveSession ? props.selectedSessionTitle ?? "未命名对话" : undefined}
          error={props.error ?? undefined}
          hostMessage={props.hostMessage}
          sidebarCollapsed={props.sidebarCollapsed}
          onSidebarToggle={props.onSidebarToggle}
        />
      ) : null}
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
          models={props.models}
          selectedModelId={props.selectedModelId}
          onModelChange={props.onModelChange}
          modelPickerDisabled={props.modelPickerDisabled}
          contextUsage={props.contextUsage}
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
          models={props.models}
          selectedModelId={props.selectedModelId}
          onModelChange={props.onModelChange}
          modelPickerDisabled={props.modelPickerDisabled}
          contextUsage={props.contextUsage}
          picker={props.picker}
        />
      )}
    </main>
  );
}
