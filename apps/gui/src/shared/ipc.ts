import type { DirectoryListing, HostProject, PersistentEvent, SessionId, SessionSummary } from "@scorel/protocol";

export type GuiHostStatus = {
  state: "starting" | "connected" | "error";
  message?: string;
};

export type GuiRelayDeviceView = {
  deviceId: string;
  label: string;
  relayUrl: string;
  online?: boolean;
  updatedAt: number;
};

export type GuiRemoteProjectView = {
  source: "relay";
  deviceId: string;
  projectId: string;
  displayName: string;
  workDir: string;
  relayUrl: string;
};

export type GuiLocalProjectView = HostProject & {
  source: "local";
};

export type GuiProjectView = GuiLocalProjectView | GuiRemoteProjectView;

export type GuiSnapshot = {
  localProjects: GuiLocalProjectView[];
  relayDevices: GuiRelayDeviceView[];
  remoteProjects: GuiRemoteProjectView[];
  projects: GuiProjectView[];
};

export type GuiProjectRef = {
  source: "local" | "relay";
  projectId: string;
  deviceId?: string;
};

export type GuiRelayPairSessionView = {
  relayUrl: string;
  clientId: string;
  pairCode: string;
  expiresAt: number;
};

export type GuiApi = {
  getHostStatus(): Promise<GuiHostStatus>;
  getSnapshot(): Promise<GuiSnapshot>;
  listLocalProjects(): Promise<HostProject[]>;
  addLocalProject(): Promise<HostProject | null>;
  createRelayPairSession(relayUrl?: string): Promise<GuiRelayPairSessionView>;
  refreshRelayDevices(relayUrl?: string): Promise<GuiRelayDeviceView[]>;
  listRemoteDirectories(deviceId: string, path?: string): Promise<DirectoryListing>;
  addRemoteProject(deviceId: string, workDir: string): Promise<GuiRemoteProjectView>;
  hideRemoteProject(deviceId: string, projectId: string): Promise<boolean>;
  listSessions(project: GuiProjectRef): Promise<SessionSummary[]>;
  createSession(project: GuiProjectRef): Promise<SessionId>;
  openSession(project: GuiProjectRef, sessionId: string): Promise<PersistentEvent[]>;
  sendMessage(project: GuiProjectRef, sessionId: string, content: string): Promise<PersistentEvent[]>;
};

export const guiIpcChannels = {
  getHostStatus: "scorel:getHostStatus",
  getSnapshot: "scorel:getSnapshot",
  listLocalProjects: "scorel:listLocalProjects",
  addLocalProject: "scorel:addLocalProject",
  createRelayPairSession: "scorel:createRelayPairSession",
  refreshRelayDevices: "scorel:refreshRelayDevices",
  listRemoteDirectories: "scorel:listRemoteDirectories",
  addRemoteProject: "scorel:addRemoteProject",
  hideRemoteProject: "scorel:hideRemoteProject",
  listSessions: "scorel:listSessions",
  createSession: "scorel:createSession",
  openSession: "scorel:openSession",
  sendMessage: "scorel:sendMessage",
} as const;
