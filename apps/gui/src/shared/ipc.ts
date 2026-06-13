import type {
  DirectoryListing,
  AvailableModelSummary,
  HostProject,
  ModelRole,
  MemoryStatus,
  MemorySettings,
  RuntimeSettings,
  ExtensionSettings,
  ProviderCatalogModelSummary,
  ProviderConnectionSummary,
  ProviderModelSummary,
  PersistentEvent,
  ScorelEvent,
  SessionId,
  SessionSummary,
  UpsertModelProfileInput,
  UpsertMemorySettingsInput,
  UpsertRuntimeSettingsInput,
  UpsertExtensionSettingsInput,
} from "@scorel/protocol";

export type GuiHostStatus = {
  state: "starting" | "connected" | "error";
  message?: string;
};

export type GuiRelayDeviceView = {
  deviceId: string;
  label: string;
  relayUrl: string;
  ip?: string;
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

export type GuiDeviceRef = {
  source: "local" | "relay";
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

export type GuiMemorySettingsView = MemorySettings;

export type GuiMemoryStatusView = MemoryStatus;

export type GuiUpsertMemorySettingsInput = Omit<UpsertMemorySettingsInput, "projectId">;

export type GuiRuntimeSettingsView = RuntimeSettings;

export type GuiUpsertRuntimeSettingsInput = Omit<UpsertRuntimeSettingsInput, "projectId">;

export type GuiExtensionSettingsView = ExtensionSettings;

export type GuiUpsertExtensionSettingsInput = UpsertExtensionSettingsInput;

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

export type GuiSessionsChangedPayload = {
  source: "local" | "relay";
  projectId: string;
  sessionId: string;
  deviceId?: string;
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
  renameRelayDevice(deviceId: string, label: string): Promise<GuiRelayDeviceView>;
  listSessions(project: GuiProjectRef): Promise<SessionSummary[]>;
  listModels(device: GuiDeviceRef): Promise<GuiModelProfileView>;
  upsertModelProfile(device: GuiDeviceRef, input: GuiUpsertModelProfileInput): Promise<GuiModelProfileView>;
  removeModelProvider(device: GuiDeviceRef, providerId: string): Promise<GuiModelProfileView & { removed: boolean }>;
  fetchProviderModels(device: GuiDeviceRef, providerId: string): Promise<GuiProviderCatalogModelView[]>;
  getMemorySettings(device: GuiDeviceRef): Promise<GuiMemorySettingsView>;
  getMemoryStatus(project: GuiProjectRef): Promise<GuiMemoryStatusView>;
  upsertMemorySettings(device: GuiDeviceRef, input: GuiUpsertMemorySettingsInput): Promise<GuiMemorySettingsView>;
  getRuntimeSettings(device: GuiDeviceRef): Promise<GuiRuntimeSettingsView>;
  upsertRuntimeSettings(device: GuiDeviceRef, input: GuiUpsertRuntimeSettingsInput): Promise<GuiRuntimeSettingsView>;
  getExtensionSettings(extensionId: string): Promise<GuiExtensionSettingsView>;
  upsertExtensionSettings(input: GuiUpsertExtensionSettingsInput): Promise<GuiExtensionSettingsView>;
  createSession(project: GuiProjectRef, modelSelection?: GuiModelSelection): Promise<SessionId>;
  openSession(project: GuiProjectRef, sessionId: string): Promise<PersistentEvent[]>;
  attachSession(project: GuiProjectRef, sessionId: string): Promise<PersistentEvent[]>;
  detachSession(sessionId: string): Promise<void>;
  sendMessage(project: GuiProjectRef, sessionId: string, content: string): Promise<GuiSendMessageAck>;
  onSessionEvent(handler: (payload: GuiSessionEventPayload) => void): () => void;
  onSessionsChanged(handler: (payload: GuiSessionsChangedPayload) => void): () => void;
  onOpenSettings(handler: () => void): () => void;
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
  renameRelayDevice: "scorel:renameRelayDevice",
  listSessions: "scorel:listSessions",
  listModels: "scorel:listModels",
  upsertModelProfile: "scorel:upsertModelProfile",
  removeModelProvider: "scorel:removeModelProvider",
  fetchProviderModels: "scorel:fetchProviderModels",
  getMemorySettings: "scorel:getMemorySettings",
  getMemoryStatus: "scorel:getMemoryStatus",
  upsertMemorySettings: "scorel:upsertMemorySettings",
  getRuntimeSettings: "scorel:getRuntimeSettings",
  upsertRuntimeSettings: "scorel:upsertRuntimeSettings",
  getExtensionSettings: "scorel:getExtensionSettings",
  upsertExtensionSettings: "scorel:upsertExtensionSettings",
  createSession: "scorel:createSession",
  openSession: "scorel:openSession",
  attachSession: "scorel:attachSession",
  detachSession: "scorel:detachSession",
  sendMessage: "scorel:sendMessage",
  sessionEvent: "scorel:sessionEvent",
  sessionsChanged: "scorel:sessionsChanged",
  openSettings: "scorel:openSettings",
} as const;
