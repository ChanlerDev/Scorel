import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { asClientId, asDeviceId, asProjectId, type HostProject } from "@scorel/protocol";

import { createGuiStore } from "./gui-store.js";

describe("GUI store", () => {
  it("starts empty when the store file is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-store-"));
    const store = createGuiStore(join(root, "gui-store.json"));

    await expect(store.load()).resolves.toEqual({
      relayDevices: [],
      visibleRemoteProjects: [],
    });
  });

  it("persists Relay Devices and selected remote Projects without importing the Host registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-store-"));
    const store = createGuiStore(join(root, "gui-store.json"));
    const device = await store.upsertRelayDevice({
      deviceId: asDeviceId("device_relay"),
      label: "Relay host",
      relayUrl: "ws://127.0.0.1:1234",
      clientId: asClientId("client_gui"),
      online: true,
    });
    const project: HostProject = {
      projectId: asProjectId("project_remote"),
      displayName: "remote-repo",
      workDir: "/srv/remote-repo",
      createdAt: 1,
      updatedAt: 1,
    };

    await store.upsertVisibleRemoteProject({ device, project });
    const snapshot = await store.load();

    expect(snapshot.relayDevices).toHaveLength(1);
    expect(snapshot.visibleRemoteProjects).toMatchObject([
      {
        deviceId: "device_relay",
        projectId: "project_remote",
        displayName: "remote-repo",
        workDir: "/srv/remote-repo",
      },
    ]);
  });

  it("hides a selected remote Project without deleting its Relay Device", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-store-"));
    const store = createGuiStore(join(root, "gui-store.json"));
    const device = await store.upsertRelayDevice({
      deviceId: asDeviceId("device_relay"),
      label: "Relay host",
      relayUrl: "ws://127.0.0.1:1234",
      clientId: asClientId("client_gui"),
    });
    await store.upsertVisibleRemoteProject({
      device,
      project: {
        projectId: asProjectId("project_remote"),
        displayName: "remote-repo",
        workDir: "/srv/remote-repo",
        createdAt: 1,
        updatedAt: 1,
      },
    });

    await expect(store.hideVisibleRemoteProject(asDeviceId("device_relay"), asProjectId("project_remote"))).resolves.toBe(true);
    await expect(store.load()).resolves.toMatchObject({
      relayDevices: [{ deviceId: "device_relay" }],
      visibleRemoteProjects: [],
    });
  });

  it("renames a paired Relay Device without changing its Relay identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-store-"));
    const store = createGuiStore(join(root, "gui-store.json"));
    await store.upsertRelayDevice({
      deviceId: asDeviceId("device_relay"),
      label: "Relay host",
      relayUrl: "ws://127.0.0.1:1234",
      clientId: asClientId("client_gui"),
      online: true,
    });

    const renamed = await store.renameRelayDevice(asDeviceId("device_relay"), "Build laptop");
    const snapshot = await store.load();

    expect(renamed).toMatchObject({
      deviceId: "device_relay",
      label: "Build laptop",
      relayUrl: "ws://127.0.0.1:1234",
      clientId: "client_gui",
      online: true,
    });
    expect(snapshot.relayDevices).toMatchObject([{ deviceId: "device_relay", label: "Build laptop" }]);
  });

  it("keeps a GUI Relay Device rename when Relay refresh returns the same device", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-store-"));
    const store = createGuiStore(join(root, "gui-store.json"));
    await store.upsertRelayDevice({
      deviceId: asDeviceId("device_relay"),
      label: "Build laptop",
      relayUrl: "ws://127.0.0.1:1234",
      clientId: asClientId("client_gui"),
      online: true,
    });

    await store.upsertRelayDevice({
      deviceId: asDeviceId("device_relay"),
      label: "Relay host",
      relayUrl: "ws://127.0.0.1:1234",
      clientId: asClientId("client_gui"),
      online: false,
    });

    await expect(store.load()).resolves.toMatchObject({
      relayDevices: [{ deviceId: "device_relay", label: "Build laptop", online: false }],
    });
  });
});
