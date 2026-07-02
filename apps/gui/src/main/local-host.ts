import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import WebSocket from "ws";

import { DaemonClient, WsTransport } from "@scorel/client";
import {
  createEmbeddedTransport,
  createRealRuntime,
  daemonStateLiveness,
  loadScorelConfig,
  loadScorelConfigProfile,
  readLocalDaemonState,
  ScorelHost,
  type ScorelHostOptions,
  type LocalDaemonState,
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
  type ObservabilitySettings,
  type RuntimeSettings,
  type ExtensionSettings,
  type ProviderCatalogModelSummary,
  type ProviderConnectionSummary,
  type ProviderModelSummary,
  type UpsertModelProfileInput,
  type UpsertMemorySettingsInput,
  type UpsertObservabilitySettingsInput,
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
  readDaemonState?: (stateDir: string) => Promise<LocalDaemonState | null>;
  ensureDaemon?: (stateDir: string) => Promise<void>;
  createWebSocket?: (url: string) => WebSocket;
};

export type GuiLocalSubscriber = (event: ScorelEvent) => void;
export type GuiLocalSessionsChangedHandler = (change: { projectId: string; sessionId: string }) => void;

export type GuiLocalHostService = {
  start(): Promise<void>;
  stop(): Promise<void>;
  listLocalProjects(): Promise<HostProject[]>;
  registerLocalProject(workDir: string): Promise<HostProject>;
  listLocalSessions(projectId: string): Promise<SessionSummary[]>;
  listLocalModels(): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }>;
  upsertLocalModelProfile(input: UpsertModelProfileInput): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }>;
  removeLocalModelProvider(providerId: string): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[]; removed: boolean }>;
  fetchLocalProviderModels(providerId: string): Promise<ProviderCatalogModelSummary[]>;
  getLocalMemorySettings(): Promise<MemorySettings>;
  getLocalMemoryStatus(projectId: string): Promise<MemoryStatus>;
  upsertLocalMemorySettings(input: UpsertMemorySettingsInput): Promise<MemorySettings>;
  getLocalRuntimeSettings(): Promise<RuntimeSettings>;
  upsertLocalRuntimeSettings(input: UpsertRuntimeSettingsInput): Promise<RuntimeSettings>;
  getLocalObservabilitySettings(): Promise<ObservabilitySettings>;
  upsertLocalObservabilitySettings(input: UpsertObservabilitySettingsInput): Promise<ObservabilitySettings>;
  getLocalExtensionSettings(extensionId: string): Promise<ExtensionSettings>;
  upsertLocalExtensionSettings(input: UpsertExtensionSettingsInput): Promise<ExtensionSettings>;
  createLocalSession(projectId: string, modelSelection?: ModelSelectionInput): Promise<SessionId>;
  openLocalSession(sessionId: string): Promise<PersistentEvent[]>;
  attachLocalSession(sessionId: string, handler: GuiLocalSubscriber): Promise<{
    events: PersistentEvent[];
    unsubscribe: () => void;
  }>;
  onLocalSessionsChanged(handler: GuiLocalSessionsChangedHandler): () => void;
  sendLocalMessage(sessionId: string, content: string, modelSelection?: ModelSelectionInput): Promise<{ accepted: true }>;
};

export const createGuiLocalHostService = (options: GuiLocalHostServiceOptions): GuiLocalHostService => {
  const hostStateDir = options.scorelHomeDir ?? options.stateDir;
  const configScope = { scorelHomeDir: hostStateDir };
  const sessionsDir = join(hostStateDir, "sessions");
  const projectsPath = join(hostStateDir, "projects.json");
  let started = false;
  let ownsEmbeddedHost = false;
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
          loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, ...configScope }),
          loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, ...configScope }),
        }),
    createRuntime:
      options.createRuntime ??
      (async ({ sessionId, project, selectedModel, purpose, backgroundBash }) =>
        createRealRuntime({
          cwd: project.workDir,
          config: await loadScorelConfig({ cwd: project.workDir, ...configScope }),
          sessionsDir,
          sessionId,
          modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : undefined,
          includeTools: purpose === "chat",
          backgroundBash,
        })),
  });
  let client = new DaemonClient(createEmbeddedTransport(host), {
    clientId: asClientId("client_gui"),
  });

  return {
    async start() {
      if (started) return;
      const readDaemonState = options.readDaemonState ?? ((stateDir) => readLocalDaemonState({ stateDir }));
      let daemonState = options.createRuntime ? null : await readDaemonState(hostStateDir);
      if ((!daemonState || daemonStateLiveness(daemonState) !== "running") && !options.createRuntime) {
        await options.ensureDaemon?.(hostStateDir);
        daemonState = await readDaemonState(hostStateDir);
      }
      if (daemonState && daemonStateLiveness(daemonState) === "running") {
        client = new DaemonClient(
          new WsTransport({
            url: daemonState.wsUrl,
            token: daemonState.token,
            createWebSocket: (url) => options.createWebSocket?.(url) ?? new WebSocket(url),
          }),
          { clientId: asClientId("client_gui") },
        );
        await client.connect();
        ownsEmbeddedHost = false;
        started = true;
        return;
      }
      if (!options.createRuntime) {
        throw new Error("local daemon is not running after start");
      }
      await mkdir(sessionsDir, { recursive: true });
      try {
        await host.start();
        await client.connect();
        ownsEmbeddedHost = true;
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
      if (ownsEmbeddedHost) {
        await host.shutdown();
      }
      ownsEmbeddedHost = false;
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
    listLocalModels() {
      return client.listModels();
    },
    upsertLocalModelProfile(input) {
      return client.upsertModelProfile(input);
    },
    removeLocalModelProvider(providerId) {
      return client.removeModelProvider({ providerId });
    },
    fetchLocalProviderModels(providerId) {
      return client.fetchProviderModels({ providerId });
    },
    getLocalMemorySettings() {
      return client.getMemorySettings();
    },
    getLocalMemoryStatus(projectId) {
      return client.getMemoryStatus({ projectId: asProjectId(projectId) as ProjectId });
    },
    upsertLocalMemorySettings(input) {
      return client.upsertMemorySettings(input);
    },
    getLocalRuntimeSettings() {
      return client.getRuntimeSettings();
    },
    upsertLocalRuntimeSettings(input) {
      return client.upsertRuntimeSettings(input);
    },
    getLocalObservabilitySettings() {
      return client.getObservabilitySettings();
    },
    upsertLocalObservabilitySettings(input) {
      return client.upsertObservabilitySettings(input);
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
    async sendLocalMessage(sessionId, content, modelSelection) {
      await client.loadSession(asSessionId(sessionId));
      await client.sendMessage(content, { modelSelection });
      return { accepted: true };
    },
  };
};
