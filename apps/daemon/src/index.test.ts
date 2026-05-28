import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  it("runs as a direct tsx command entrypoint", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-app-daemon-entrypoint-"));
    const result = await runDaemonEntrypoint(["--help"], stateDir);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Usage: scorel-daemon start|status|stop");
  });
});

const runDaemonEntrypoint = (
  argv: string[],
  stateDir: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const entrypoint = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
    const child = spawn(process.execPath, ["--import", "tsx", entrypoint, ...argv], {
      env: { ...process.env, HOME: stateDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
