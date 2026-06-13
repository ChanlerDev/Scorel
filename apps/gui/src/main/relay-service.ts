import { DaemonClient, RelayTransport } from "@scorel/client";
import {
  asClientId,
  asDeviceId,
  asProjectId,
  asRequestId,
  asSessionId,
  type ClientId,
  type DeviceId,
  type DirectoryListing,
  type ModelSelectionInput,
  type AvailableModelSummary,
  type ModelRole,
  type MemoryStatus,
  type MemorySettings,
  type RuntimeSettings,
  type ProviderCatalogModelSummary,
  type ProviderConnectionSummary,
  type ProviderModelSummary,
  type UpsertModelProfileInput,
  type UpsertMemorySettingsInput,
  type UpsertRuntimeSettingsInput,
  type PersistentEvent,
  type ProjectId,
  type RelayAuthorizedDevice,
  type RelayEntryFrame,
  type RelayResponse,
  type RelayServerFrame,
  type ScorelEvent,
  type SessionId,
  type SessionSummary,
} from "@scorel/protocol";
import WebSocket from "ws";

import type { GuiRelayDevice, GuiStore, GuiVisibleRemoteProject } from "./gui-store.js";

export const DEFAULT_GUI_RELAY_URL = "wss://scorel-relay.chanler.dev";
const GUI_CLIENT_ID = asClientId("client_gui");

export type RelayPairSession = {
  relayUrl: string;
  clientId: ClientId;
  pairCode: string;
  expiresAt: number;
};

export type GuiRelaySubscriber = (event: ScorelEvent) => void;

export type GuiRelayService = {
  createPairSession(relayUrl?: string): Promise<RelayPairSession>;
  refreshAuthorizedDevices(relayUrl?: string): Promise<GuiRelayDevice[]>;
  listRemoteDirectories(deviceId: string, path?: string): Promise<DirectoryListing>;
  registerRemoteProject(deviceId: string, workDir: string): Promise<GuiVisibleRemoteProject>;
  listRemoteSessions(deviceId: string, projectId: string): Promise<SessionSummary[]>;
  listRemoteModels(deviceId: string): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }>;
  upsertRemoteModelProfile(deviceId: string, input: UpsertModelProfileInput): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[] }>;
  removeRemoteModelProvider(deviceId: string, providerId: string): Promise<{ providers: ProviderConnectionSummary[]; providerModels: ProviderModelSummary[]; models: AvailableModelSummary[]; roles: Record<ModelRole, string>; warnings?: string[]; removed: boolean }>;
  fetchRemoteProviderModels(deviceId: string, providerId: string): Promise<ProviderCatalogModelSummary[]>;
  getRemoteMemorySettings(deviceId: string): Promise<MemorySettings>;
  getRemoteMemoryStatus(deviceId: string, projectId: string): Promise<MemoryStatus>;
  upsertRemoteMemorySettings(deviceId: string, input: UpsertMemorySettingsInput): Promise<MemorySettings>;
  getRemoteRuntimeSettings(deviceId: string): Promise<RuntimeSettings>;
  upsertRemoteRuntimeSettings(deviceId: string, input: UpsertRuntimeSettingsInput): Promise<RuntimeSettings>;
  createRemoteSession(deviceId: string, projectId: string, modelSelection?: ModelSelectionInput): Promise<SessionId>;
  openRemoteSession(deviceId: string, sessionId: string): Promise<PersistentEvent[]>;
  attachRemoteSession(
    deviceId: string,
    sessionId: string,
    handler: GuiRelaySubscriber,
  ): Promise<{ events: PersistentEvent[]; unsubscribe: () => void }>;
  sendRemoteMessage(deviceId: string, sessionId: string, content: string): Promise<{ accepted: true }>;
  close(): void;
};

type RelayClientEntry = {
  device: GuiRelayDevice;
  client: DaemonClient;
};

export const createGuiRelayService = (store: GuiStore): GuiRelayService => {
  const clients = new Map<string, RelayClientEntry>();

  const requireDevice = async (deviceId: string): Promise<GuiRelayDevice> => {
    const devices = await store.listRelayDevices();
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) {
      throw new Error(`Relay Device is not configured: ${deviceId}`);
    }
    return device;
  };

  const connectedClient = async (deviceId: string): Promise<DaemonClient> => {
    const device = await requireDevice(deviceId);
    const cacheKey = String(device.deviceId);
    const cached = clients.get(cacheKey);
    if (cached?.device.relayUrl === device.relayUrl && cached.device.clientId === device.clientId && cached.client.state === "connected") {
      return cached.client;
    }
    cached?.client.disconnect();
    const client = new DaemonClient(
      new RelayTransport({
        relayUrl: device.relayUrl,
        deviceId: device.deviceId,
        clientId: device.clientId,
        createWebSocket: (url) => new WebSocket(url) as never,
      }),
      { clientId: device.clientId },
    );
    await client.connect();
    clients.set(cacheKey, { device, client });
    return client;
  };

  return {
    async createPairSession(relayUrl = defaultRelayUrl()) {
      return createRelayPairSession({ relayUrl, clientId: GUI_CLIENT_ID });
    },
    async refreshAuthorizedDevices(relayUrl = defaultRelayUrl()) {
      const devices = await listAuthorizedRelayDevices({ relayUrl, clientId: GUI_CLIENT_ID });
      const persisted: GuiRelayDevice[] = [];
      for (const device of devices) {
        persisted.push(
          await store.upsertRelayDevice({
            deviceId: device.deviceId,
            label: device.label ?? String(device.deviceId),
            relayUrl,
            clientId: GUI_CLIENT_ID,
            online: device.online,
          }),
        );
      }
      return persisted;
    },
    async listRemoteDirectories(deviceId, path) {
      return (await connectedClient(deviceId)).listDirectories(path);
    },
    async registerRemoteProject(deviceId, workDir) {
      const device = await requireDevice(deviceId);
      const project = await (await connectedClient(deviceId)).registerProject(workDir);
      return store.upsertVisibleRemoteProject({ device, project });
    },
    async listRemoteSessions(deviceId, projectId) {
      return (await connectedClient(deviceId)).listSessions({ projectId: asProjectId(projectId) as ProjectId });
    },
    async listRemoteModels(deviceId) {
      return (await connectedClient(deviceId)).listModels();
    },
    async upsertRemoteModelProfile(deviceId, input) {
      return (await connectedClient(deviceId)).upsertModelProfile(input);
    },
    async removeRemoteModelProvider(deviceId, providerId) {
      return (await connectedClient(deviceId)).removeModelProvider({ providerId });
    },
    async fetchRemoteProviderModels(deviceId, providerId) {
      return (await connectedClient(deviceId)).fetchProviderModels({ providerId });
    },
    async getRemoteMemorySettings(deviceId) {
      return (await connectedClient(deviceId)).getMemorySettings();
    },
    async getRemoteMemoryStatus(deviceId, projectId) {
      return (await connectedClient(deviceId)).getMemoryStatus({ projectId: asProjectId(projectId) as ProjectId });
    },
    async upsertRemoteMemorySettings(deviceId, input) {
      return (await connectedClient(deviceId)).upsertMemorySettings(input);
    },
    async getRemoteRuntimeSettings(deviceId) {
      return (await connectedClient(deviceId)).getRuntimeSettings();
    },
    async upsertRemoteRuntimeSettings(deviceId, input) {
      return (await connectedClient(deviceId)).upsertRuntimeSettings(input);
    },
    async createRemoteSession(deviceId, projectId, modelSelection) {
      return (await connectedClient(deviceId)).createSession({ meta: { projectId: asProjectId(projectId) as ProjectId, modelSelection } });
    },
    async openRemoteSession(deviceId, sessionId) {
      const client = await connectedClient(deviceId);
      await client.loadSession(asSessionId(sessionId));
      return client.getEvents().filter((event) => event.sessionId === sessionId);
    },
    async attachRemoteSession(deviceId, sessionId, handler) {
      const client = await connectedClient(deviceId);
      await client.loadSession(asSessionId(sessionId));
      const filteredHandler: GuiRelaySubscriber = (event) => {
        if (event.sessionId === sessionId) handler(event);
      };
      const unsubscribe = client.subscribe(filteredHandler);
      const events = client.getEvents().filter((event) => event.sessionId === sessionId);
      return { events, unsubscribe };
    },
    async sendRemoteMessage(deviceId, sessionId, content) {
      const client = await connectedClient(deviceId);
      await client.loadSession(asSessionId(sessionId));
      await client.sendMessage(content);
      return { accepted: true };
    },
    close() {
      for (const entry of clients.values()) {
        entry.client.disconnect();
      }
      clients.clear();
    },
  };
};

export const defaultRelayUrl = (): string => process.env.SCOREL_RELAY_URL?.trim() || DEFAULT_GUI_RELAY_URL;

export const createRelayPairSession = async (
  input: { relayUrl: string; clientId: ClientId },
): Promise<RelayPairSession> => {
  const socket = await openRelaySocket(input.relayUrl);
  try {
    sendRelayFrame(socket, { type: "entry_hello", clientId: input.clientId, label: "Scorel GUI" });
    sendRelayFrame(socket, { type: "create_pair_session", requestId: asRequestId("gui_pair"), clientId: input.clientId });
    const response = await waitForRelayResponse(socket);
    if (!response.ok) {
      throw new Error(response.message);
    }
    if (!("pairCode" in response.data)) {
      throw new Error("Relay pair response missing pairCode");
    }
    return {
      relayUrl: input.relayUrl,
      clientId: input.clientId,
      pairCode: response.data.pairCode,
      expiresAt: response.data.expiresAt,
    };
  } finally {
    socket.close();
  }
};

export const listAuthorizedRelayDevices = async (
  input: { relayUrl: string; clientId: ClientId },
): Promise<RelayAuthorizedDevice[]> => {
  const socket = await openRelaySocket(input.relayUrl);
  try {
    sendRelayFrame(socket, { type: "entry_hello", clientId: input.clientId, label: "Scorel GUI" });
    sendRelayFrame(socket, { type: "list_authorized_devices", requestId: asRequestId("gui_devices") });
    const response = await waitForRelayResponse(socket);
    if (!response.ok) {
      throw new Error(response.message);
    }
    if (!("devices" in response.data)) {
      throw new Error("Relay device response missing devices");
    }
    return response.data.devices;
  } finally {
    socket.close();
  }
};

const openRelaySocket = (relayUrl: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });

const sendRelayFrame = (socket: WebSocket, frame: RelayEntryFrame): void => {
  if (socket.readyState !== socket.OPEN) {
    throw new Error("Relay socket is not connected");
  }
  socket.send(JSON.stringify(frame));
};

const waitForRelayResponse = (socket: WebSocket): Promise<RelayResponse> =>
  new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.on("message", function handle(data) {
      const frame = JSON.parse(data.toString()) as RelayServerFrame;
      if (frame.type !== "relay_response" && frame.type !== "relay_error") return;
      socket.off("message", handle);
      resolve(frame);
    });
  });

export const asGuiDeviceId = (deviceId: string): DeviceId => asDeviceId(deviceId);
