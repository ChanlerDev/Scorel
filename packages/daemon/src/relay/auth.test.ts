import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { asClientId } from "@scorel/protocol";

import {
  authorizeRelayClient,
  hostRelayAuthPath,
  isRelayClientAuthorized,
  loadOrCreateHostDeviceIdentity,
  readHostRelayAuth,
} from "./auth.js";

describe("Host relay auth", () => {
  it("loads or creates a stable Host device identity", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-relay-identity-"));

    const first = await loadOrCreateHostDeviceIdentity({ stateDir, displayName: "Test host" });
    const second = await loadOrCreateHostDeviceIdentity({ stateDir, displayName: "Ignored" });

    expect(first.deviceId).toMatch(/^device_/);
    expect(second).toEqual(first);
  });

  it("persists authorized clients idempotently", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-relay-auth-"));

    await authorizeRelayClient({ stateDir, clientId: asClientId("client_web"), now: () => 100 });
    await authorizeRelayClient({ stateDir, clientId: asClientId("client_web"), now: () => 200 });

    await expect(isRelayClientAuthorized({ stateDir, clientId: asClientId("client_web") })).resolves.toBe(true);
    await expect(readHostRelayAuth(stateDir)).resolves.toEqual({
      version: 1,
      clients: [{ clientId: "client_web", createdAt: 100 }],
    });
    expect(await readFile(hostRelayAuthPath(stateDir), "utf8")).toContain("client_web");
  });
});
