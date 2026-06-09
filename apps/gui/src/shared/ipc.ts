import type {
  DirectoryListing,
  AvailableModelSummary,
  HostProject,
  ModelRole,
  ProviderCatalogModelSummary,
  ProviderConnectionSummary,
  ProviderModelSummary,
  PersistentEvent,
  ScorelEvent,
  SessionId,
  SessionSummary,
  UpsertModelProfileInput,
} from "@scorel/protocol";

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

export type GuiModelSelection = {
  modelId?: string;
  role?: ModelRole;
};

export type GuiModelProfileView = {
  providers: ProviderConnectionSummary[];
  providerModels: ProviderModelSummary[];
  models: AvailableModelSummary[];
  roles: Record<ModelRole, string>;
  warnings?: string[];
};

export type GuiUpsertModelProfileInput = Omit<UpsertModelProfileInput, "projectId">;

export type GuiProviderCatalogModelView = ProviderCatalogModelSummary;

export type GuiRelayPairSessionView = {
  relayUrl: string;
  clientId: string;
  pairCode: string;
  expiresAt: number;
};

export type GuiSendMessageAck = {
  accepted: true;
};

export type GuiSessionEventPayload = {
  sessionId: SessionId;
  event: ScorelEvent;
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
  listModels(project: GuiProjectRef): Promise<GuiModelProfileView>;
  upsertModelProfile(project: GuiProjectRef, input: GuiUpsertModelProfileInput): Promise<GuiModelProfileView>;
  fetchProviderModels(project: GuiProjectRef, providerId: string): Promise<GuiProviderCatalogModelView[]>;
  createSession(project: GuiProjectRef, modelSelection?: GuiModelSelection): Promise<SessionId>;
  openSession(project: GuiProjectRef, sessionId: string): Promise<PersistentEvent[]>;
  attachSession(project: GuiProjectRef, sessionId: string): Promise<PersistentEvent[]>;
  detachSession(sessionId: string): Promise<void>;
  sendMessage(project: GuiProjectRef, sessionId: string, content: string): Promise<GuiSendMessageAck>;
  onSessionEvent(handler: (payload: GuiSessionEventPayload) => void): () => void;
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
  listModels: "scorel:listModels",
  upsertModelProfile: "scorel:upsertModelProfile",
  fetchProviderModels: "scorel:fetchProviderModels",
  createSession: "scorel:createSession",
  openSession: "scorel:openSession",
  attachSession: "scorel:attachSession",
  detachSession: "scorel:detachSession",
  sendMessage: "scorel:sendMessage",
  sessionEvent: "scorel:sessionEvent",
} as const;
