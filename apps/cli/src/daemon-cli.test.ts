import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createLocalDaemonState,
  readLocalDaemonState,
} from "@scorel/daemon";

import { runCliDaemon } from "./daemon-cli.js";

class StringWritable extends Writable {
  #chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#chunks.push(chunk.toString());
    callback();
  }

  override toString(): string {
    return this.#chunks.join("");
  }
}

describe("scorel daemon CLI", () => {
  it("status reports `not configured` when the state file is missing", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-status-missing-"));
    const out = new StringWritable();
    const err = new StringWritable();

    const code = await runCliDaemon(["status"], { stateDir, output: out, error: err });
    expect(code).toBe(1);
    expect(err.toString()).toContain("scorel daemon not configured");
  });

  it("status with a running pid prints url + token for loopback hosts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-status-running-"));
    await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "loopback-token",
      pid: process.pid,
      startedAt: 100,
      stoppedAt: null,
    });
    const out = new StringWritable();
    const err = new StringWritable();

    const code = await runCliDaemon(["status"], { stateDir, output: out, error: err });
    expect(code).toBe(0);
    expect(out.toString()).toContain("running url=ws://127.0.0.1:7777");
    expect(out.toString()).toContain(`pid=${process.pid}`);
    expect(out.toString()).toContain("token=loopback-token");
  });

  it("status hides the token on non-loopback hosts unless --show-token", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-status-public-"));
    await createLocalDaemonState({
      stateDir,
      host: "10.0.0.5",
      port: 7777,
      wsUrl: "ws://10.0.0.5:7777",
      token: "secret-token",
      pid: process.pid,
      startedAt: 100,
      stoppedAt: null,
    });
    const hidden = new StringWritable();
    const hiddenErr = new StringWritable();
    await runCliDaemon(["status"], { stateDir, output: hidden, error: hiddenErr });
    expect(hidden.toString()).not.toContain("secret-token");

    const shown = new StringWritable();
    const shownErr = new StringWritable();
    await runCliDaemon(["status"], { stateDir, output: shown, error: shownErr });
    // sanity: still hidden without --show-token
    expect(shown.toString()).not.toContain("secret-token");

    const explicit = new StringWritable();
    const explicitErr = new StringWritable();
    await runCliDaemon(["status", "--show-token"], { stateDir, output: explicit, error: explicitErr });
    expect(explicit.toString()).toContain("token=secret-token");
  });

  it("status reports stopped when stoppedAt is populated", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-status-stopped-"));
    await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "tok",
      pid: process.pid,
      startedAt: 100,
      stoppedAt: 200,
    });
    const out = new StringWritable();
    const err = new StringWritable();
    const code = await runCliDaemon(["status"], { stateDir, output: out, error: err });
    expect(code).toBe(0);
    expect(out.toString()).toContain("stopped");
    expect(out.toString()).toContain("stoppedAt=");
  });

  it("reset deletes the state file", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-reset-"));
    await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "tok",
      pid: 1,
      startedAt: 100,
      stoppedAt: 200,
    });
    const out = new StringWritable();
    const err = new StringWritable();
    const code = await runCliDaemon(["reset"], { stateDir, output: out, error: err });
    expect(code).toBe(0);
    expect(out.toString()).toContain("daemon state reset");
    expect(await readLocalDaemonState({ stateDir })).toBeNull();
  });

  it("stop is a no-op when the daemon is already stopped", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-stop-noop-"));
    await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "tok",
      pid: process.pid,
      startedAt: 100,
      stoppedAt: 250,
    });
    const out = new StringWritable();
    const err = new StringWritable();
    const code = await runCliDaemon(["stop"], { stateDir, output: out, error: err });
    expect(code).toBe(0);
    expect(out.toString()).toContain("already stopped");
  });

  it("serve refuses to overwrite a running daemon", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-running-"));
    await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "tok",
      pid: process.pid,
      startedAt: 100,
      stoppedAt: null,
    });
    const out = new StringWritable();
    const err = new StringWritable();
    const code = await runCliDaemon(["serve", "--port", "0"], { stateDir, output: out, error: err });
    expect(code).toBe(1);
    expect(err.toString()).toContain("already running");
  });

  it("serve reuses the persisted token across restarts and clears it on reset", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-reuse-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-sessions-"));
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-cwd-"));
    await writeConfig(cwd);

    const out = new StringWritable();
    const err = new StringWritable();
    const abort1 = new AbortController();
    const serving1 = runCliDaemon(["serve", "--port", "0", "--cwd", cwd], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
      serveSignal: abort1.signal,
    });
    await waitForText(out, "scorel daemon serving url=ws://127.0.0.1:");
    const persistedFirst = await readLocalDaemonState({ stateDir });
    expect(persistedFirst).not.toBeNull();
    abort1.abort();
    await expect(serving1).resolves.toBe(0);
    const persistedAfterFirst = await readLocalDaemonState({ stateDir });
    expect(persistedAfterFirst?.stoppedAt).not.toBeNull();
    expect(persistedAfterFirst?.token).toBe(persistedFirst!.token);

    const abort2 = new AbortController();
    const out2 = new StringWritable();
    const err2 = new StringWritable();
    const serving2 = runCliDaemon(["serve", "--port", "0", "--cwd", cwd], {
      stateDir,
      sessionsDir,
      output: out2,
      error: err2,
      serveSignal: abort2.signal,
    });
    await waitForText(out2, "scorel daemon serving url=ws://127.0.0.1:");
    const persistedSecond = await readLocalDaemonState({ stateDir });
    expect(persistedSecond?.token).toBe(persistedFirst!.token);
    expect(persistedSecond?.stoppedAt).toBeNull();
    abort2.abort();
    await expect(serving2).resolves.toBe(0);

    // reset should clear the file so the next serve generates a new token.
    await runCliDaemon(["reset"], { stateDir, output: new StringWritable(), error: new StringWritable() });
    expect(await readLocalDaemonState({ stateDir })).toBeNull();
  }, 15_000);

  it("serve overwrites an orphaned state file (dead pid + stoppedAt: null)", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-orphan-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-orphan-sessions-"));
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-orphan-cwd-"));
    await writeConfig(cwd);
    // Use a pid that cannot be alive: process 0 is reserved on POSIX and
    // process.kill(0, 0) throws ESRCH/EPERM on most platforms.
    await createLocalDaemonState({
      stateDir,
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "orphan-token",
      pid: 0x7fffffff, // unlikely to be a real pid
      startedAt: 1,
      stoppedAt: null, // crashed-orphan shape
    });

    const abort = new AbortController();
    const out = new StringWritable();
    const err = new StringWritable();
    const serving = runCliDaemon(["serve", "--port", "0", "--cwd", cwd], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
      serveSignal: abort.signal,
    });
    await waitForText(out, "scorel daemon serving url=ws://127.0.0.1:");
    const persisted = await readLocalDaemonState({ stateDir });
    // Token reused from the orphan file (per spec).
    expect(persisted?.token).toBe("orphan-token");
    expect(persisted?.pid).toBe(process.pid);
    abort.abort();
    await expect(serving).resolves.toBe(0);
  }, 15_000);
});

const writeConfig = async (cwd: string): Promise<void> => {
  await writeFile(
    join(cwd, ".scorel.config.toml"),
    "",
  ).catch(() => undefined);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".scorel"), { recursive: true });
  await writeFile(
    join(cwd, ".scorel", "config.toml"),
    `[model]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
id = "gpt-5.4-mini"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"
contextWindow = 400000
maxTokens = 128000
reasoning = true
`,
  );
  process.env.SCOREL_API_KEY = "chanleramp";
};

const waitForText = (writable: { toString(): string }, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (writable.toString().includes(text)) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt > 8000) {
        clearInterval(interval);
        reject(new Error(`timed out waiting for ${text}`));
      }
    }, 5);
  });

// Touch readFile import so unused-import lint doesn't trip.
void readFile;
