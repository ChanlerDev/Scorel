import { useState } from "react";

import { AddRemoteProjectDialog } from "../composer/AddRemoteProjectDialog.js";
import { ProjectPickerMenu } from "../composer/ProjectPickerMenu.js";
import type { Turn } from "../chatbox/projector.js";
import type { GuiProjectView, GuiRelayDeviceView, GuiRemoteProjectView, GuiSnapshot } from "../../shared/ipc.js";
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
  projects: GuiProjectView[];
  selectedProjectKey: string | null;
  relayDevices: GuiRelayDeviceView[];
  onSelectProject(key: string): void;
  onAddLocalProject(): void;
  onProjectAdded(project: GuiRemoteProjectView): void;
  setError(message: string | null): void;
  refreshSnapshot(): Promise<GuiSnapshot>;
};

export function Workspace(props: WorkspaceProps) {
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [showAddRemote, setShowAddRemote] = useState<boolean>(false);

  const picker = pickerOpen ? (
    <ProjectPickerMenu
      projects={props.projects}
      selectedKey={props.selectedProjectKey}
      onSelect={(key) => props.onSelectProject(key)}
      onAddLocal={() => props.onAddLocalProject()}
      onAddRemote={() => setShowAddRemote(true)}
      onClose={() => setPickerOpen(false)}
    />
  ) : null;

  const remoteDialog = showAddRemote ? (
    <AddRemoteProjectDialog
      devices={props.relayDevices}
      initialDeviceId={props.relayDevices[0]?.deviceId}
      onClose={() => setShowAddRemote(false)}
      onSubmitted={(project) => {
        props.onProjectAdded(project);
        void props.refreshSnapshot();
      }}
      setError={props.setError}
    />
  ) : null;

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
          onPickerOpen={() => setPickerOpen(true)}
          busy={props.busy}
          inFlight={props.inFlight}
          picker={picker}
        />
      ) : (
        <EmptyState
          selectedProject={props.selectedProject}
          message={props.message}
          onMessageChange={props.onMessageChange}
          onSubmit={props.onSubmit}
          onPickerOpen={() => setPickerOpen(true)}
          busy={props.busy}
          inFlight={props.inFlight}
          picker={picker}
        />
      )}
      {remoteDialog}
    </main>
  );
}
