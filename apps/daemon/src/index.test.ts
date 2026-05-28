import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { daemonAppDependency, daemonAppName, runDaemonCommand } from "@scorel/app-daemon";

describe("@scorel/app-daemon", () => {
  it("is an entrypoint shell over daemon", () => {
    expect(daemonAppName).toBe("@scorel/app-daemon");
    expect(daemonAppDependency).toBe("@scorel/daemon");
  });

  it("reports stopped status when no local daemon state exists", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-app-daemon-"));
    const output: string[] = [];

    const code = await runDaemonCommand(["status"], {
      stateDir,
      output: { write: (chunk: string) => output.push(chunk) },
      error: { write: (chunk: string) => output.push(chunk) },
    });

    expect(code).toBe(1);
    expect(output.join("")).toContain("scorel daemon stopped");
  });

  it("starts, reports, and stops local daemon state", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-app-daemon-"));
    const output: string[] = [];
    const io = {
      stateDir,
      output: { write: (chunk: string) => output.push(chunk) },
      error: { write: (chunk: string) => output.push(chunk) },
    };

    await expect(runDaemonCommand(["start"], io)).resolves.toBe(0);
    expect(output.join("")).toContain("scorel daemon started");

    output.length = 0;
    await expect(runDaemonCommand(["status"], io)).resolves.toBe(0);
    expect(output.join("")).toContain("scorel daemon running");

    output.length = 0;
    await expect(runDaemonCommand(["stop"], io)).resolves.toBe(0);
    expect(output.join("")).toContain("scorel daemon stopped");
  });
});
