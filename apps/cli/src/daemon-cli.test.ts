import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalDaemonState,
  readLocalDaemonState,
} from "@scorel/daemon";
import { FileRelayStore, MemoryRelayDiagnostics, startRelayServer } from "../../../apps/relay/src/library.js";

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

type FakeChild = EventEmitter & {
  stdout: Readable | null;
  stderr: Readable | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  unref: () => void;
  exit: (code: number) => void;
  killSignals: NodeJS.Signals[];
  unrefCalled: boolean;
};

const makeChild = (): FakeChild => {
  const emitter = new EventEmitter() as FakeChild;
  emitter.stdout = new Readable({ read() {} });
  emitter.stderr = new Readable({ read() {} });
  emitter.killSignals = [];
  emitter.unrefCalled = false;
  emitter.kill = (signal) => {
    if (signal) emitter.killSignals.push(signal);
    return true;
  };
  emitter.unref = () => {
    emitter.unrefCalled = true;
  };
  emitter.exit = (code) => {
    emitter.stdout?.push(null);
    emitter.stderr?.push(null);
    emitter.emit("exit", code);
  };
  return emitter;
};

describe("scorel daemon CLI", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("start launches the Host daemon in the background and returns after readiness", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-start-"));
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-start-cwd-"));
    const child = makeChild();
    const spawnCalls: Array<{ command: string; argv: string[]; cwd?: string; detached?: boolean }> = [];
    const out = new StringWritable();
    const err = new StringWritable();
    let readCalls = 0;

    const started = runCliDaemon(["start", "--port", "0", "--cwd", cwd, "--no-relay"], {
      stateDir,
      output: out,
      error: err,
      cliEntrypoint: "/cli/index.ts",
      spawn: (command, argv, opts) => {
        spawnCalls.push({ command, argv, cwd: String(opts.cwd), detached: opts.detached });
        return child as never;
      },
      readState: async () => {
        readCalls += 1;
        return readCalls > 1
          ? {
              host: "127.0.0.1",
              port: 7777,
              wsUrl: "ws://127.0.0.1:7777",
              token: "tok",
              pid: process.pid,
              startedAt: 1,
              stoppedAt: null,
            }
          : null;
      },
      daemonReadyTimeoutMs: 1000,
    });

    child.stdout!.push("scorel host serving url=ws://127.0.0.1:7777\n");
    await expect(started).resolves.toBe(0);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({ command: process.execPath, cwd: "/cli", detached: true });
    expect(spawnCalls[0]!.argv).toEqual(expect.arrayContaining(["host", "serve", "--cwd", cwd, "--no-relay"]));
    expect(spawnCalls[0]!.argv).toEqual(expect.arrayContaining(["--idle-timeout-ms", "0"]));
    expect(child.unrefCalled).toBe(true);
    expect(child.killSignals).toEqual([]);
    expect(out.toString()).toContain("scorel host started url=ws://127.0.0.1:7777");
    expect(err.toString()).toBe("");
  });

  it("start allows slow development Host startup before timing out", async () => {
    vi.useFakeTimers();
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-start-slow-"));
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-start-slow-cwd-"));
    const child = makeChild();
    const out = new StringWritable();
    const err = new StringWritable();
    let readCalls = 0;

    const started = runCliDaemon(["start", "--port", "0", "--cwd", cwd, "--no-relay"], {
      stateDir,
      output: out,
      error: err,
      cliEntrypoint: "/cli/index.ts",
      spawn: () => child as never,
      readState: async () => {
        readCalls += 1;
        return readCalls > 1
          ? {
              host: "127.0.0.1",
              port: 7777,
              wsUrl: "ws://127.0.0.1:7777",
              token: "tok",
              pid: process.pid,
              startedAt: 1,
              stoppedAt: null,
            }
          : null;
      },
    });

    await vi.advanceTimersByTimeAsync(12_000);
    child.stdout!.push("scorel host serving url=ws://127.0.0.1:7777\n");

    await expect(started).resolves.toBe(0);
    expect(child.killSignals).toEqual([]);
    expect(out.toString()).toContain("scorel host started url=ws://127.0.0.1:7777");
    expect(err.toString()).toBe("");
  });

  it("start reuses an already-running Host daemon", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-start-reuse-"));
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
    let spawnCount = 0;

    const code = await runCliDaemon(["start", "--no-relay"], {
      stateDir,
      output: out,
      error: err,
      spawn: () => {
        spawnCount += 1;
        return makeChild() as never;
      },
    });

    expect(code).toBe(0);
    expect(spawnCount).toBe(0);
    expect(out.toString()).toContain("scorel host already running");
    expect(err.toString()).toBe("");
  });

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
    const code = await runCliDaemon(["serve", "--port", "0", "--no-relay"], { stateDir, output: out, error: err });
    expect(code).toBe(1);
    expect(err.toString()).toContain("already running");
  });

  it("serve exits on idle timeout when there are no clients or active IM extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-idle-"));
    const stateDir = join(root, ".scorel");
    const sessionsDir = join(stateDir, "sessions");
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-idle-cwd-"));
    await writeConfig(cwd);

    const out = new StringWritable();
    const err = new StringWritable();
    const serving = runCliDaemon(["serve", "--port", "0", "--cwd", cwd, "--no-relay", "--idle-timeout-ms", "20"], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
    });

    await waitForText(out, "scorel host serving url=ws://127.0.0.1:");
    await expect(serving).resolves.toBe(0);
    expect(out.toString()).toContain("scorel host serve stopped reason=idle");
    expect((await readLocalDaemonState({ stateDir }))?.stoppedAt).not.toBeNull();
    expect(err.toString()).toBe("");
  });

  it("serve stays alive by default until the foreground process is stopped", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-foreground-"));
    const stateDir = join(root, ".scorel");
    const sessionsDir = join(stateDir, "sessions");
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-foreground-cwd-"));
    await writeConfig(cwd);

    const out = new StringWritable();
    const err = new StringWritable();
    const abort = new AbortController();
    const serving = runCliDaemon(["serve", "--port", "0", "--cwd", cwd, "--no-relay"], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
      serveSignal: abort.signal,
    });

    await waitForText(out, "scorel host serving url=ws://127.0.0.1:");
    await sleep(80);
    expect(out.toString()).not.toContain("reason=idle");
    abort.abort();
    await expect(serving).resolves.toBe(0);
    expect(out.toString()).toContain("scorel host serve stopped reason=abort");
    expect(err.toString()).toBe("");
  });

  it("serve does not idle-exit while an IM extension is active", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-im-active-"));
    const stateDir = join(root, ".scorel");
    const sessionsDir = join(stateDir, "sessions");
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-im-active-cwd-"));
    await writeConfig(cwd);
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "config.toml"), [
      "[extensions.loopback]",
      "enabled = true",
      'kind = "im"',
      "",
    ].join("\n"));

    const out = new StringWritable();
    const err = new StringWritable();
    const abort = new AbortController();
    const serving = runCliDaemon(["serve", "--port", "0", "--cwd", cwd, "--no-relay", "--idle-timeout-ms", "20"], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
      serveSignal: abort.signal,
    });

    await waitForText(out, "scorel host serving url=ws://127.0.0.1:");
    await sleep(80);
    expect(out.toString()).not.toContain("reason=idle");
    abort.abort();
    await expect(serving).resolves.toBe(0);
    expect(out.toString()).toContain("scorel host serve stopped reason=abort");
    expect(err.toString()).toBe("");
  });

  it("serve reuses the persisted token across restarts and clears it on reset", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-reuse-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-sessions-"));
    const cwd = await mkdtemp(join(tmpdir(), "scorel-daemon-serve-cwd-"));
    await writeConfig(cwd);

    const out = new StringWritable();
    const err = new StringWritable();
    const abort1 = new AbortController();
    const serving1 = runCliDaemon(["serve", "--port", "0", "--cwd", cwd, "--no-relay"], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
      serveSignal: abort1.signal,
    });
    await waitForText(out, "scorel host serving url=ws://127.0.0.1:");
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
    const serving2 = runCliDaemon(["serve", "--port", "0", "--cwd", cwd, "--no-relay"], {
      stateDir,
      sessionsDir,
      output: out2,
      error: err2,
      serveSignal: abort2.signal,
    });
    await waitForText(out2, "scorel host serving url=ws://127.0.0.1:");
    const persistedSecond = await readLocalDaemonState({ stateDir });
    expect(persistedSecond?.token).toBe(persistedFirst!.token);
    expect(persistedSecond?.stoppedAt).toBeNull();
    abort2.abort();
    await expect(serving2).resolves.toBe(0);

    // reset should clear the file so the next serve generates a new token.
    await runCliDaemon(["reset"], { stateDir, output: new StringWritable(), error: new StringWritable() });
    expect(await readLocalDaemonState({ stateDir })).toBeNull();
  }, 15_000);

  it("host serve connects to the default relay URL from SCOREL_RELAY_URL", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-host-serve-relay-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-host-serve-relay-sessions-"));
    const cwd = await mkdtemp(join(tmpdir(), "scorel-host-serve-relay-cwd-"));
    await writeConfig(cwd);
    const relay = await startRelayServer({
      host: "127.0.0.1",
      port: 0,
      store: new FileRelayStore({ dataDir: join(stateDir, "relay") }),
      diagnostics: new MemoryRelayDiagnostics(),
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
      env: { ...process.env, SCOREL_RELAY_URL: relay.url },
    });
    try {
      await waitForText(out, "scorel host relay connected url=");
      expect(out.toString()).toContain("scorel hosted webui https://scorel.chanler.dev");
    } finally {
      abort.abort();
      await expect(serving).resolves.toBe(0);
      await relay.close();
    }
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
    const serving = runCliDaemon(["serve", "--port", "0", "--cwd", cwd, "--no-relay"], {
      stateDir,
      sessionsDir,
      output: out,
      error: err,
      serveSignal: abort.signal,
    });
    await waitForText(out, "scorel host serving url=ws://127.0.0.1:");
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
    `[providers.chanleramp]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
baseUrl = "https://amp.chanler.dev/v1"
apiKeyEnv = "SCOREL_API_KEY"

[models.main]
provider = "chanleramp"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"
contextWindow = 400000
maxTokens = 128000
reasoning = true

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Touch readFile import so unused-import lint doesn't trip.
void readFile;
