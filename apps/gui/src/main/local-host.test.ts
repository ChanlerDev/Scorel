import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ScorelRuntime, type RuntimeProvider } from "@scorel/core";
import { describe, expect, it } from "vitest";

import { createGuiLocalHostService } from "./local-host.js";

const provider: RuntimeProvider = {
  streamTurn: async function* () {
    return {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "end_turn",
    };
  },
};

describe("GUI local Host service", () => {
  it("starts an embedded Host and lists registered local Projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-host-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);

      await expect(service.listLocalProjects()).resolves.toEqual([project]);
    } finally {
      await service.stop();
    }
  });

  it("creates local Project sessions and returns persisted chat events", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-workspace-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const sessionId = await service.createLocalSession(project.projectId);

      await expect(service.listLocalSessions(project.projectId)).resolves.toMatchObject([
        { sessionId, projectId: project.projectId },
      ]);

      const events = await service.sendLocalMessage(sessionId, "hello gui");

      expect(events.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "hello gui")).toBe(true);
      expect(events.some((event) => event.type === "assistant_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "ok")).toBe(true);
      await expect(service.openLocalSession(sessionId)).resolves.toEqual(events);
    } finally {
      await service.stop();
    }
  });

  it("keeps local transcript events scoped to the opened Session", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-gui-workspace-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    const service = createGuiLocalHostService({
      stateDir: root,
      deviceId: "device_gui_test",
      createRuntime: async () => new ScorelRuntime({ provider }),
    });

    await service.start();
    try {
      const project = await service.registerLocalProject(repo);
      const first = await service.createLocalSession(project.projectId);
      const second = await service.createLocalSession(project.projectId);

      await service.sendLocalMessage(first, "first prompt");
      const secondEvents = await service.sendLocalMessage(second, "second prompt");

      expect(secondEvents.every((event) => event.sessionId === second)).toBe(true);
      expect(secondEvents.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "second prompt")).toBe(true);
      expect(secondEvents.some((event) => event.type === "user_message" && event.message.content[0]?.type === "text" && event.message.content[0].text === "first prompt")).toBe(false);
    } finally {
      await service.stop();
    }
  });
});
