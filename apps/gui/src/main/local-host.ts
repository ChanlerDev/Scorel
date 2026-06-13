import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { DaemonClient } from "@scorel/client";
import {
  createEmbeddedTransport,
  createRealRuntime,
  loadScorelConfig,
  loadScorelConfigProfile,
  ScorelHost,
  type ScorelHostOptions,
} from "@scorel/daemon";
import {
  asClientId,
  asDeviceId,
  asProjectId,
  asSessionId,
  type HostProject,
  type ModelSelectionInput,
  type AvailableModelSummary,
  type ModelRole,
  type MemoryStatus,
  type MemorySettings,
  type RuntimeSettings,
  type ExtensionSettings,
  type ProviderCatalogModelSummary,
  type ProviderConnectionSummary,
  type ProviderModelSummary,
  type UpsertModelProfileInput,
  type UpsertMemorySettingsInput,
  type UpsertRuntimeSettingsInput,
  type UpsertExtensionSettingsInput,
  type PersistentEvent,
  type ProjectId,
  type ScorelEvent,
  type SessionId,
  type SessionSummary,
} from "@scorel/protocol";

type RuntimeFactory = ScorelHostOptions["createRuntime"];

export type GuiLocalHostServiceOptions = {
  stateDir: string;
  scorelHomeDir?: string;
  deviceId?: string;
  deviceDisplayName?: string;
  createRuntime?: RuntimeFactory;
};

export type GuiLocalSubscriber = (event: ScorelEvent) => void;
export type GuiLocalSessionsChangedHandler = (change: { projectId: string; sessionId: string }) => void;

export type GuiLocalHostService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  listLocalProjects(): Promise<HostProject[]>;
  registerLocalProject(workDir: string): Promise<HostProject>;
  listLocalSessions(projectId: string): Promise<SessionSummary[]>;
  listLocalModels(projectId: string): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }>;
  upsertLocalModelProfile(input: UpsertModelProfileInput): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }>;
  removeLocalModelProvider(projectId: string, providerId: string): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[]; removed: boolean }>;
  fetchLocalProviderModels(projectId: string, providerId: string): Promise<ProviderCatalogModelSummary[]>;
  getLocalMemorySettings(projectId: string): Promise<MemorySettings>;
  getLocalMemoryStatus(projectId: string): Promise<MemoryStatus>;
  upsertLocalMemorySettings(input: UpsertMemorySettingsInput): Promise<MemorySettings>;
  getLocalRuntimeSettings(projectId: string): Promise<RuntimeSettings>;
  upsertLocalRuntimeSettings(input: UpsertRuntimeSettingsInput): Promise<RuntimeSettings>;
  getLocalExtensionSettings(extensionId: string): Promise<ExtensionSettings>;
  upsertLocalExtensionSettings(input: UpsertExtensionSettingsInput): Promise<ExtensionSettings>;
  createLocalSession(projectId: string, modelSelection?: ModelSelectionInput): Promise<SessionId>;
  openLocalSession(sessionId: string): Promise<PersistentEvent[]>;
  attachLocalSession(sessionId: string, handler: GuiLocalSubscriber): Promise<{
    events: PersistentEvent[];
    unsubscribe: () => void;
  }>;
  onLocalSessionsChanged(handler: GuiLocalSessionsChangedHandler): () => void;
  sendLocalMessage(sessionId: string, content: string): Promise<{ accepted: true }>;
};

export const createGuiLocalHostService = (options: GuiLocalHostServiceOptions): GuiLocalHostService => {
  const sessionsDir = join(options.stateDir, "sessions");
  const projectsPath = join(options.stateDir, "projects.json");
  let started = false;
  const sessionChangeHandlers = new Set<GuiLocalSessionsChangedHandler>();
  const host = new ScorelHost({
    sessionsDir,
    projectsPath,
    ...(options.scorelHomeDir ? { scorelHomeDir: options.scorelHomeDir } : {}),
    deviceId: asDeviceId(options.deviceId ?? "device_gui_local"),
    deviceDisplayName: options.deviceDisplayName ?? "Local",
    onSessionListChanged: (change) => {
      for (const handler of sessionChangeHandlers) {
        handler({ projectId: change.projectId, sessionId: change.sessionId });
      }
    },
    ...(options.createRuntime
      ? {}
      : {
          loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir }),
          loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir }),
        }),
    createRuntime:
      options.createRuntime ??
      (async ({ project, selectedModel, purpose }) =>
        createRealRuntime({
          cwd: project.workDir,
          config: await loadScorelConfig({ cwd: project.workDir }),
          modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : undefined,
          includeTools: purpose === "chat",
        })),
  });
  const client = new DaemonClient(createEmbeddedTransport(host), {
    clientId: asClientId("client_gui"),
  });

  return {
    async start() {
      if (started) return;
      await mkdir(sessionsDir, { recursive: true });
      try {
        await host.start();
        await client.connect();
        started = true;
      } catch (cause) {
        client.disconnect();
        await host.shutdown();
        throw cause;
      }
    },
    async stop() {
      if (!started) return;
      client.disconnect();
      await host.shutdown();
      started = false;
    },
    listLocalProjects() {
      return client.listProjects();
    },
    registerLocalProject(workDir) {
      return client.registerProject(workDir);
    },
    listLocalSessions(projectId) {
      return client.listSessions({ projectId: asProjectId(projectId) as ProjectId });
    },
    listLocalModels(projectId) {
      return client.listModels({ projectId: asProjectId(projectId) as ProjectId });
    },
    upsertLocalModelProfile(input) {
      return client.upsertModelProfile(input);
    },
    removeLocalModelProvider(projectId, providerId) {
      return client.removeModelProvider({ projectId: asProjectId(projectId) as ProjectId, providerId });
    },
    fetchLocalProviderModels(projectId, providerId) {
      return client.fetchProviderModels({ projectId: asProjectId(projectId) as ProjectId, providerId });
    },
    getLocalMemorySettings(projectId) {
      return client.getMemorySettings({ projectId: asProjectId(projectId) as ProjectId });
    },
    getLocalMemoryStatus(projectId) {
      return client.getMemoryStatus({ projectId: asProjectId(projectId) as ProjectId });
    },
    upsertLocalMemorySettings(input) {
      return client.upsertMemorySettings(input);
    },
    getLocalRuntimeSettings(projectId) {
      return client.getRuntimeSettings({ projectId: asProjectId(projectId) as ProjectId });
    },
    upsertLocalRuntimeSettings(input) {
      return client.upsertRuntimeSettings(input);
    },
    getLocalExtensionSettings(extensionId) {
      return client.getExtensionSettings({ extensionId });
    },
    upsertLocalExtensionSettings(input) {
      return client.upsertExtensionSettings(input);
    },
    createLocalSession(projectId, modelSelection) {
      return client.createSession({ meta: { projectId: asProjectId(projectId) as ProjectId, modelSelection } });
    },
    async openLocalSession(sessionId) {
      await client.loadSession(asSessionId(sessionId));
      return client.getEvents().filter((event) => event.sessionId === sessionId);
    },
    async attachLocalSession(sessionId, handler) {
      await client.loadSession(asSessionId(sessionId));
      const filteredHandler: GuiLocalSubscriber = (event) => {
        if (event.sessionId === sessionId) handler(event);
      };
      const unsubscribe = client.subscribe(filteredHandler);
      const events = client.getEvents().filter((event) => event.sessionId === sessionId);
      return { events, unsubscribe };
    },
    onLocalSessionsChanged(handler) {
      sessionChangeHandlers.add(handler);
      return () => {
        sessionChangeHandlers.delete(handler);
      };
    },
    async sendLocalMessage(sessionId, content) {
      await client.loadSession(asSessionId(sessionId));
      await client.sendMessage(content);
      return { accepted: true };
    },
  };
};
