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
});
