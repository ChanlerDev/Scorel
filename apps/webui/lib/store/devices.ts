import { BrowserStore } from "./browser-store";
import { normalizeLink } from "../domain/link";
import type {
  Device,
  DeviceConnector,
  DeviceProject,
  RelayConnector,
  DeviceSessionSummary,
} from "../domain/devices";

export const DEVICES_KEY = "devices";

const NAME_MIN = 1;
const NAME_MAX = 64;
const TOKEN_MIN = 1;
const TOKEN_MAX = 4096;

export type CreateDeviceInput = {
  name: string;
  link: string;
  token: string;
};

export type UpdateDevicePatch = Partial<Omit<Device, "id" | "createdAt">>;

export type AddRelayConnectorInput = {
  name?: string;
  relayUrl: string;
  deviceId: string;
  clientId: string;
};

function validateName(name: unknown): string {
  if (typeof name !== "string") throw new Error("invalid name");
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    throw new Error("invalid name");
  }
  return trimmed;
}

function validateToken(token: unknown): string {
  if (typeof token !== "string") throw new Error("invalid token");
  if (token.length < TOKEN_MIN || token.length > TOKEN_MAX) {
    throw new Error("invalid token");
  }
  return token;
}

function validateLinkOrThrow(link: unknown): string {
  if (typeof link !== "string") throw new Error("invalid link");
  try {
    return normalizeLink(link);
  } catch {
    throw new Error("invalid link");
  }
}

export class DevicesStore {
  readonly #store: BrowserStore;
  #snapshot: Device[] | null = null;

  constructor(store: BrowserStore) {
    this.#store = store;
  }

  list(): Device[] {
    if (this.#snapshot === null) {
      const raw = this.#store.get<Device[]>(DEVICES_KEY) ?? [];
      this.#snapshot = Array.isArray(raw) ? raw.map(normalizeStoredDevice) : [];
    }
    return this.#snapshot;
  }

  get(id: string): Device | undefined {
    return this.list().find((d) => d.id === id);
  }

  create(input: CreateDeviceInput): Device {
    const name = validateName(input.name);
    const link = validateLinkOrThrow(input.link);
    const token = validateToken(input.token);

    const id =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : fallbackId();
    const device: Device = {
      id,
      name,
      link,
      token,
      connectors: [directConnector(link, token)],
      createdAt: Date.now(),
    };
    const next = [...this.list(), device];
    this.#commit(next);
    return device;
  }

  update(id: string, patch: UpdateDevicePatch): Device | undefined {
    const list = this.list();
    const index = list.findIndex((d) => d.id === id);
    if (index < 0) return undefined;
    const current = list[index] as Device;
    const next: Device = { ...current };

    if (patch.name !== undefined) next.name = validateName(patch.name);
    if (patch.link !== undefined) next.link = validateLinkOrThrow(patch.link);
    if (patch.token !== undefined) next.token = validateToken(patch.token);
    if (patch.link !== undefined || patch.token !== undefined) {
      next.connectors = upsertDirectConnector(next.connectors ?? [], next.link, next.token);
    }
    if (patch.connectors !== undefined) next.connectors = patch.connectors;
    if (patch.lastConnectedAt !== undefined) next.lastConnectedAt = patch.lastConnectedAt;
    if (patch.remoteIdentity !== undefined) next.remoteIdentity = patch.remoteIdentity;
    if (patch.projects !== undefined) next.projects = patch.projects;
    if (patch.projectsFetchedAt !== undefined) next.projectsFetchedAt = patch.projectsFetchedAt;

    const updated = [...list];
    updated[index] = next;
    this.#commit(updated);
    return next;
  }

  remove(id: string): void {
    const list = this.list();
    const next = list.filter((d) => d.id !== id);
    if (next.length === list.length) return;
    this.#commit(next);
  }

  markIdentity(
    id: string,
    remoteIdentity: { deviceId?: string; deviceDisplayName?: string },
  ): Device | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    if (!remoteIdentity.deviceId) return current;
    const merged: { deviceId: string; deviceDisplayName?: string } = {
      deviceId: remoteIdentity.deviceId,
    };
    if (remoteIdentity.deviceDisplayName !== undefined) {
      merged.deviceDisplayName = remoteIdentity.deviceDisplayName;
    }
    return this.update(id, { remoteIdentity: merged });
  }

  addRelayConnector(input: AddRelayConnectorInput): Device {
    const relayConnector: RelayConnector = {
      id: `relay:${input.relayUrl}:${input.deviceId}`,
      kind: "relay",
      relayUrl: input.relayUrl,
      deviceId: input.deviceId,
      clientId: input.clientId,
    };
    const existing = this.list().find((device) =>
      device.remoteIdentity?.deviceId === input.deviceId ||
      (device.connectors ?? []).some((connector) => connector.kind === "relay" && connector.deviceId === input.deviceId),
    );
    if (existing) {
      const connectors = upsertRelayConnector(existing.connectors ?? [], relayConnector);
      return this.update(existing.id, {
        connectors,
        remoteIdentity: {
          deviceId: input.deviceId,
          deviceDisplayName: existing.remoteIdentity?.deviceDisplayName,
        },
      }) as Device;
    }
    const now = Date.now();
    const device: Device = {
      id: typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : fallbackId(),
      name: validateName(input.name ?? input.deviceId),
      link: input.relayUrl,
      token: "",
      connectors: [relayConnector],
      remoteIdentity: { deviceId: input.deviceId },
      createdAt: now,
    };
    this.#commit([...this.list(), device]);
    return device;
  }

  markConnectedAt(id: string, ts: number): Device | undefined {
    return this.update(id, { lastConnectedAt: ts });
  }

  /**
   * Replace the project list for a device with a fresh snapshot from
   * `list_projects`. Per S0036: the array itself is overwritten wholesale, but
   * for project slugs that survive the snapshot we preserve any cached
   * `sessions`/`sessionsFetchedAt` so a reconnect doesn't blow away the
   * lazily-loaded session list. Stamps `projectsFetchedAt` to `Date.now()`.
   */
  setProjects(id: string, projects: DeviceProject[]): Device | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const previousByslug = new Map<string, DeviceProject>();
    for (const prev of current.projects ?? []) {
      previousByslug.set(prev.projectId, prev);
    }
    const merged = projects.map<DeviceProject>((next) => {
      const prev = previousByslug.get(next.projectId);
      if (!prev) return { ...next };
      const carry: Partial<DeviceProject> = {};
      if (prev.sessions !== undefined) carry.sessions = prev.sessions;
      if (prev.sessionsFetchedAt !== undefined) {
        carry.sessionsFetchedAt = prev.sessionsFetchedAt;
      }
      return { ...next, ...carry };
    });
    return this.update(id, {
      projects: merged,
      projectsFetchedAt: Date.now(),
    });
  }

  /**
   * Replace the cached session map under a single (device, projectId). No-op
   * if the device or project slug is unknown — the caller is expected to have
   * synced projects first.
   */
  setProjectSessions(
    id: string,
    projectId: string,
    sessions: Record<string, DeviceSessionSummary>,
  ): Device | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const list = current.projects ?? [];
    const idx = list.findIndex((p) => p.projectId === projectId);
    if (idx < 0) return current;
    const updated: DeviceProject = {
      ...(list[idx] as DeviceProject),
      sessions,
      sessionsFetchedAt: Date.now(),
    };
    const nextProjects = [...list];
    nextProjects[idx] = updated;
    return this.update(id, { projects: nextProjects });
  }

  subscribe(listener: () => void): () => void {
    return this.#store.subscribe(DEVICES_KEY, () => {
      // Cross-tab updates also reach here; invalidate the snapshot first.
      this.#snapshot = null;
      listener();
    });
  }

  #commit(next: Device[]): void {
    this.#snapshot = next;
    this.#store.set(DEVICES_KEY, next);
  }
}

function fallbackId(): string {
  // Fallback only: jsdom + Node 22+ ship crypto.randomUUID; this is a safety net
  // for unusual environments.
  const rand = Math.random().toString(16).slice(2, 10);
  const time = Date.now().toString(16);
  return `${time}-${rand}`;
}

function directConnector(url: string, token: string): DeviceConnector {
  return {
    id: `direct:${url}`,
    kind: "direct_ws",
    url,
    token,
  };
}

function normalizeStoredDevice(device: Device): Device {
  const connectors = device.connectors && device.connectors.length > 0
    ? device.connectors
    : device.link && device.token
      ? [directConnector(device.link, device.token)]
      : [];
  return { ...device, connectors };
}

function upsertDirectConnector(connectors: DeviceConnector[], url: string, token: string): DeviceConnector[] {
  const direct = directConnector(url, token);
  const withoutDirect = connectors.filter((connector) => connector.kind !== "direct_ws");
  return [direct, ...withoutDirect];
}

function upsertRelayConnector(connectors: DeviceConnector[], relay: RelayConnector): DeviceConnector[] {
  const next = connectors.filter((connector) => !(connector.kind === "relay" && connector.deviceId === relay.deviceId));
  next.push(relay);
  return next;
}
