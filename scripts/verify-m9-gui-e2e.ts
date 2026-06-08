#!/usr/bin/env -S node --import tsx
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRealRuntime,
  loadScorelConfig,
  redeemRelayPair,
  ScorelHost,
  startHostRelayClient,
  type HostRelayClient,
} from "../packages/daemon/src/index.js";
import { asDeviceId } from "../packages/protocol/src/index.js";
import { FileRelayStore, MemoryRelayDiagnostics, startRelayServer, type RelayServer } from "../apps/relay/src/library.js";
import { createGuiStore } from "../apps/gui/src/main/gui-store.js";
import { createGuiLocalHostService } from "../apps/gui/src/main/local-host.js";
import { createGuiRelayService } from "../apps/gui/src/main/relay-service.js";

type Managed = {
  relay?: RelayServer;
  hostRelay?: HostRelayClient;
  remoteHost?: ScorelHost;
  tempRoot?: string;
};

const managed: Managed = {};

const main = async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "scorel-m9-gui-e2e-"));
  managed.tempRoot = root;
  const localRepo = join(root, "local-repo");
  const remoteRepo = join(root, "remote-repo");
  await mkdir(localRepo, { recursive: true });
  await mkdir(remoteRepo, { recursive: true });
  await writeFile(join(localRepo, "README.md"), "# M9 GUI local e2e\n");
  await writeFile(join(remoteRepo, "README.md"), "# M9 GUI Relay e2e\n");

  await assertProviderAvailable(localRepo);

  const local = await verifyLocalPath(root, localRepo);
  const relay = await verifyRelayPath(root, remoteRepo);

  console.log(JSON.stringify({
    ok: true,
    local,
    relay,
  }, null, 2));
};

const assertProviderAvailable = async (cwd: string): Promise<void> => {
  try {
    await loadScorelConfig({ cwd });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`M9 GUI real-provider e2e cannot run: ${message}`);
  }
};

const verifyLocalPath = async (root: string, repo: string) => {
  const service = createGuiLocalHostService({
    stateDir: join(root, "gui-local-state"),
    deviceId: "device_gui_m9_local",
  });
  await service.start();
  try {
    const project = await service.registerLocalProject(repo);
    const sessionId = await service.createLocalSession(project.projectId);
    const events = await service.sendLocalMessage(sessionId, "M9 GUI local e2e. Reply with one short sentence.");
    assertAssistant(events, "local");
    return {
      projectId: project.projectId,
      sessionId,
      eventCount: events.length,
    };
  } finally {
    await service.stop();
  }
};

const verifyRelayPath = async (root: string, repo: string) => {
  const relay = await startRelayServer({
    host: "127.0.0.1",
    port: 0,
    store: new FileRelayStore({ dataDir: join(root, "relay") }),
    diagnostics: new MemoryRelayDiagnostics(),
  });
  managed.relay = relay;

  const guiStore = createGuiStore(join(root, "gui-store.json"));
  const guiRelay = createGuiRelayService(guiStore);
  const pair = await guiRelay.createPairSession(relay.url);

  const remoteStateDir = join(root, "remote-host-state");
  const remoteHost = new ScorelHost({
    sessionsDir: join(remoteStateDir, "sessions"),
    projectsPath: join(remoteStateDir, "projects.json"),
    deviceId: asDeviceId("device_gui_m9_remote"),
    deviceDisplayName: "M9 Remote Host",
    createRuntime: async ({ project }) =>
      createRealRuntime({
        cwd: project.workDir,
        config: await loadScorelConfig({ cwd: project.workDir }),
      }),
  });
  await remoteHost.start();
  managed.remoteHost = remoteHost;

  await redeemRelayPair({
    relayUrl: relay.url,
    pairCode: pair.pairCode,
    deviceId: asDeviceId("device_gui_m9_remote"),
    label: "M9 Remote Host",
    stateDir: remoteStateDir,
  });

  const hostRelay = await startHostRelayClient({
    relayUrl: relay.url,
    hostService: remoteHost,
    deviceId: asDeviceId("device_gui_m9_remote"),
    deviceDisplayName: "M9 Remote Host",
    stateDir: remoteStateDir,
    reconnectDelayMs: 50,
  });
  managed.hostRelay = hostRelay;

  try {
    const devices = await guiRelay.refreshAuthorizedDevices(relay.url);
    const device = devices.find((candidate) => candidate.deviceId === "device_gui_m9_remote");
    if (!device) {
      throw new Error("GUI Relay service did not discover the paired remote Device");
    }
    if (device.online !== true) {
      throw new Error("Paired remote Device is not online");
    }
    const selected = await guiRelay.registerRemoteProject(device.deviceId, repo);
    const sessionId = await guiRelay.createRemoteSession(device.deviceId, selected.projectId);
    const events = await guiRelay.sendRemoteMessage(device.deviceId, sessionId, "M9 GUI Relay e2e. Reply with one short sentence.");
    assertAssistant(events, "relay");
    return {
      relayUrl: relay.url,
      deviceId: device.deviceId,
      projectId: selected.projectId,
      sessionId,
      eventCount: events.length,
    };
  } finally {
    guiRelay.close();
  }
};

const assertAssistant = (events: { type: string }[], label: string): void => {
  if (!events.some((event) => event.type === "user_message")) {
    throw new Error(`${label} e2e did not persist a user_message`);
  }
  if (!events.some((event) => event.type === "assistant_message")) {
    throw new Error(`${label} e2e did not persist an assistant_message`);
  }
};

const cleanup = async (): Promise<void> => {
  managed.hostRelay?.close();
  await managed.remoteHost?.shutdown();
  await managed.relay?.close();
  if (managed.tempRoot) {
    await rm(managed.tempRoot, { recursive: true, force: true });
  }
};

main()
  .catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  })
  .finally(cleanup);
