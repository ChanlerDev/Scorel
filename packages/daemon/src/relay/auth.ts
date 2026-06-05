import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { asDeviceId, type ClientId, type DeviceId } from "@scorel/protocol";

export type HostDeviceIdentity = {
  version: 1;
  deviceId: DeviceId;
  displayName: string;
};

export type HostRelayAuthFile = {
  version: 1;
  clients: Array<{
    clientId: ClientId;
    createdAt: number;
    label?: string;
  }>;
};

export const hostDeviceIdentityPath = (stateDir: string): string => join(stateDir, "device.json");

export const hostRelayAuthPath = (stateDir: string): string => join(stateDir, "relay-auth.json");

export const loadOrCreateHostDeviceIdentity = async (
  options: { stateDir: string; displayName?: string; now?: () => number },
): Promise<HostDeviceIdentity> => {
  const existing = await readHostDeviceIdentity(options.stateDir);
  if (existing) {
    return existing;
  }
  const identity: HostDeviceIdentity = {
    version: 1,
    deviceId: asDeviceId(`device_${randomUUID()}`),
    displayName: options.displayName ?? "Local daemon",
  };
  await mkdir(options.stateDir, { recursive: true });
  await writeFile(hostDeviceIdentityPath(options.stateDir), `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
};

export const readHostDeviceIdentity = async (stateDir: string): Promise<HostDeviceIdentity | null> => {
  try {
    const raw = JSON.parse(await readFile(hostDeviceIdentityPath(stateDir), "utf8")) as Partial<HostDeviceIdentity>;
    if (raw.version !== 1 || typeof raw.deviceId !== "string" || typeof raw.displayName !== "string") {
      return null;
    }
    return {
      version: 1,
      deviceId: asDeviceId(raw.deviceId),
      displayName: raw.displayName,
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return null;
    }
    throw cause;
  }
};

export const readHostRelayAuth = async (stateDir: string): Promise<HostRelayAuthFile> => {
  try {
    const raw = JSON.parse(await readFile(hostRelayAuthPath(stateDir), "utf8")) as Partial<HostRelayAuthFile>;
    if (raw.version !== 1 || !Array.isArray(raw.clients)) {
      return emptyAuthFile();
    }
    return {
      version: 1,
      clients: raw.clients.filter((client): client is HostRelayAuthFile["clients"][number] => typeof client.clientId === "string" && typeof client.createdAt === "number"),
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return emptyAuthFile();
    }
    throw cause;
  }
};

export const authorizeRelayClient = async (
  options: { stateDir: string; clientId: ClientId; label?: string; now?: () => number },
): Promise<HostRelayAuthFile> => {
  const auth = await readHostRelayAuth(options.stateDir);
  const existing = auth.clients.find((client) => client.clientId === options.clientId);
  if (existing) {
    return auth;
  }
  auth.clients.push({
    clientId: options.clientId,
    createdAt: (options.now ?? Date.now)(),
    label: options.label,
  });
  await mkdir(options.stateDir, { recursive: true });
  await writeFile(hostRelayAuthPath(options.stateDir), `${JSON.stringify(auth, null, 2)}\n`);
  return auth;
};

export const isRelayClientAuthorized = async (
  options: { stateDir: string; clientId: ClientId },
): Promise<boolean> => {
  const auth = await readHostRelayAuth(options.stateDir);
  return auth.clients.some((client) => client.clientId === options.clientId);
};

const emptyAuthFile = (): HostRelayAuthFile => ({
  version: 1,
  clients: [],
});
