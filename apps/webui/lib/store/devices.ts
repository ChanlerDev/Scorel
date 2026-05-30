import { BrowserStore } from "./browser-store";
import { normalizeLink } from "../domain/link";
import type { Device } from "../domain/devices";

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
      this.#snapshot = Array.isArray(raw) ? raw : [];
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

  markConnectedAt(id: string, ts: number): Device | undefined {
    return this.update(id, { lastConnectedAt: ts });
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
