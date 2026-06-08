import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ScorelRuntime, type RuntimeProvider } from "@scorel/core";
import { ScorelHost, startHostRelayClient, type HostRelayClient } from "@scorel/daemon";
import { asClientId, asDeviceId } from "@scorel/protocol";
import { FileRelayStore, MemoryRelayDiagnostics, startRelayServer, type RelayServer } from "../../../../apps/relay/src/library.js";

import { createGuiStore } from "./gui-store.js";
import { createGuiRelayService, createRelayPairSession } from "./relay-service.js";

const servers: RelayServer[] = [];
const relayClients: HostRelayClient[] = [];
const hosts: ScorelHost[] = [];
const tempDirs: string[] = [];
const provider: RuntimeProvider = {
  streamTurn: async function* () {
    return {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "end_turn",
    };
  },
};

afterEach(async () => {
  for (const relayClient of relayClients.splice(0)) {
    relayClient.close();
  }
  for (const host of hosts.splice(0)) {
    await host.shutdown();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("GUI Relay service", () => {
  it("creates a Relay pair session for the GUI client", async () => {
    const fixture = await relayFixture();

    const pair = await createRelayPairSession({
      relayUrl: fixture.relay.url,
      clientId: asClientId("client_gui"),
    });

    expect(pair).toMatchObject({
      relayUrl: fixture.relay.url,
      clientId: "client_gui",
    });
    expect(pair.pairCode).toMatch(/^\d{6}$/);
    expect(pair.expiresAt).toBeGreaterThan(Date.now());
  });

  it("lists authorized Relay Devices, selects remote Projects, and sends prompts through Relay", async () => {
    const fixture = await relayFixture();
    const remoteRoot = await mkdtemp(join(tmpdir(), "scorel-gui-remote-root-"));
    tempDirs.push(remoteRoot);
    const repo = join(remoteRoot, "repo");
    await mkdir(repo);
    await startRemoteHost(fixture.relay.url, fixture.root);
    await fixture.store.bind({ deviceId: asDeviceId("device_remote"), clientId: asClientId("client_gui") });
    const serviceStore = createGuiStore(join(fixture.root, "gui-store.json"));
    const service = createGuiRelayService(serviceStore);

    try {
      const devices = await service.refreshAuthorizedDevices(fixture.relay.url);
      const listing = await service.listRemoteDirectories("device_remote", remoteRoot);
      const selected = await service.registerRemoteProject("device_remote", repo);
      const sessionId = await service.createRemoteSession("device_remote", selected.projectId);
      const seen: string[] = [];
      const { unsubscribe } = await service.attachRemoteSession("device_remote", sessionId, (event) => {
        seen.push(event.type);
      });
      const ack = await service.sendRemoteMessage("device_remote", sessionId, "hello relay gui");
      expect(ack).toEqual({ accepted: true });
      const events = await service.openRemoteSession("device_remote", sessionId);
      const snapshot = await serviceStore.load();

      expect(devices).toMatchObject([{ deviceId: "device_remote", online: true }]);
      expect(listing.entries).toMatchObject([{ name: "repo", kind: "directory" }]);
      expect(selected).toMatchObject({
        deviceId: "device_remote",
        displayName: "repo",
        workDir: await realpath(repo),
      });
      expect(events.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "hello relay gui")).toBe(true);
      expect(events.some((event) => event.type === "assistant_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "ok")).toBe(true);
      expect(snapshot.visibleRemoteProjects).toHaveLength(1);
      expect(seen).toContain("user_message");
      expect(seen).toContain("assistant_message");
      unsubscribe();
    } finally {
      service.close();
    }
  });
});

async function relayFixture() {
  const root = await mkdtemp(join(tmpdir(), "scorel-gui-relay-"));
  tempDirs.push(root);
  const store = new FileRelayStore({ dataDir: join(root, "relay") });
  const relay = await startRelayServer({
    host: "127.0.0.1",
    port: 0,
    store,
    diagnostics: new MemoryRelayDiagnostics(),
  });
  servers.push(relay);
  return { root, relay, store };
}

async function startRemoteHost(relayUrl: string, root: string): Promise<void> {
  const host = new ScorelHost({
    sessionsDir: join(root, "sessions"),
    projectsPath: join(root, "projects.json"),
    deviceId: asDeviceId("device_remote"),
    deviceDisplayName: "Remote host",
    createRuntime: async () => new ScorelRuntime({ provider }),
  });
  await host.start();
  hosts.push(host);
  relayClients.push(
    await startHostRelayClient({
      relayUrl,
      hostService: host,
      deviceId: asDeviceId("device_remote"),
      deviceDisplayName: "Remote host",
      stateDir: root,
      isAuthorized: async (clientId) => clientId === "client_gui",
      reconnectDelayMs: 10,
    }),
  );
}
