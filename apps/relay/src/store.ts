import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ClientId,
  DeviceId,
  RelayBindingRecord,
  RelayClientRecord,
  RelayDeviceRecord,
} from "@scorel/protocol";

export interface RelayStore {
  upsertDevice(record: RelayDeviceRecord): Promise<void>;
  upsertClient(record: RelayClientRecord): Promise<void>;
  bind(input: { deviceId: DeviceId; clientId: ClientId }): Promise<void>;
  isBound(input: { deviceId: DeviceId; clientId: ClientId }): Promise<boolean>;
  listDevicesForClient(clientId: ClientId): Promise<RelayDeviceRecord[]>;
}

type RelayStoreFile = {
  version: 1;
  devices: RelayDeviceRecord[];
  clients: RelayClientRecord[];
  bindings: RelayBindingRecord[];
};

export class FileRelayStore implements RelayStore {
  readonly #filePath: string;
  readonly #now: () => number;
  #queue = Promise.resolve();

  constructor(options: { dataDir: string; now?: () => number }) {
    this.#filePath = join(options.dataDir, "relay-store.json");
    this.#now = options.now ?? Date.now;
  }

  async upsertDevice(record: RelayDeviceRecord): Promise<void> {
    await this.#mutate((file) => {
      const existing = file.devices.find((candidate) => candidate.deviceId === record.deviceId);
      if (existing) {
        Object.assign(existing, { ...record, createdAt: existing.createdAt, updatedAt: record.updatedAt });
      } else {
        file.devices.push(record);
      }
    });
  }

  async upsertClient(record: RelayClientRecord): Promise<void> {
    await this.#mutate((file) => {
      const existing = file.clients.find((candidate) => candidate.clientId === record.clientId);
      if (existing) {
        Object.assign(existing, { ...record, createdAt: existing.createdAt, updatedAt: record.updatedAt });
      } else {
        file.clients.push(record);
      }
    });
  }

  async bind(input: { deviceId: DeviceId; clientId: ClientId }): Promise<void> {
    await this.#mutate((file) => {
      if (!file.bindings.some((binding) => binding.deviceId === input.deviceId && binding.clientId === input.clientId)) {
        file.bindings.push({ ...input, createdAt: this.#now() });
      }
    });
  }

  async isBound(input: { deviceId: DeviceId; clientId: ClientId }): Promise<boolean> {
    const file = await this.#read();
    return file.bindings.some((binding) => binding.deviceId === input.deviceId && binding.clientId === input.clientId);
  }

  async listDevicesForClient(clientId: ClientId): Promise<RelayDeviceRecord[]> {
    const file = await this.#read();
    const deviceIds = new Set(file.bindings.filter((binding) => binding.clientId === clientId).map((binding) => binding.deviceId));
    return file.devices.filter((device) => deviceIds.has(device.deviceId));
  }

  async #mutate(mutator: (file: RelayStoreFile) => void): Promise<void> {
    this.#queue = this.#queue.then(async () => {
      const file = await this.#read();
      mutator(file);
      await mkdir(join(this.#filePath, ".."), { recursive: true });
      await writeFile(this.#filePath, `${JSON.stringify(file, null, 2)}\n`);
    });
    await this.#queue;
  }

  async #read(): Promise<RelayStoreFile> {
    try {
      const raw = JSON.parse(await readFile(this.#filePath, "utf8")) as Partial<RelayStoreFile>;
      if (raw.version !== 1 || !Array.isArray(raw.devices) || !Array.isArray(raw.clients) || !Array.isArray(raw.bindings)) {
        return emptyStoreFile();
      }
      return {
        version: 1,
        devices: raw.devices,
        clients: raw.clients,
        bindings: raw.bindings,
      };
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
        return emptyStoreFile();
      }
      throw cause;
    }
  }
}

const emptyStoreFile = (): RelayStoreFile => ({
  version: 1,
  devices: [],
  clients: [],
  bindings: [],
});
