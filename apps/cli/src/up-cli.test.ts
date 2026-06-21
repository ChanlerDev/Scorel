import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCliUp } from "./up-cli.js";

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

describe("scorel up orchestrator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns daemon, waits for the ready line, then spawns webui and prints the unified header", async () => {
    const daemon = makeChild();
    const webui = makeChild();
    let spawnCalls = 0;
    const spawnCwds: string[] = [];
    const spawnArgvs: string[][] = [];
    const spawnFn = (_command: string, argv: string[], opts: SpawnOptions) => {
      spawnCalls += 1;
      spawnCwds.push(String(opts.cwd));
      spawnArgvs.push(argv);
      const isDaemon = argv.includes("daemon");
      return (isDaemon ? daemon : webui) as unknown as ReturnType<typeof import("node:child_process").spawn>;
    };

    const out = new StringWritable();
    const err = new StringWritable();
    let sigintHandler: (() => void) | undefined;
    const upPromise = runCliUp(
      ["--daemon-port", "7800", "--webui-port", "3100"],
      {
        output: out,
        error: err,
        stateDir: "/state",
        spawn: spawnFn,
        cliEntrypoint: "/cli/index.ts",
        readState: async () =>
          spawnCalls === 0
            ? null
            : {
                host: "127.0.0.1",
                port: 7800,
                wsUrl: "ws://127.0.0.1:7800",
                token: "auto-token",
                pid: 99,
                startedAt: 1,
                stoppedAt: null,
              },
        attachSigint: (handler) => {
          sigintHandler = handler;
          return () => undefined;
        },
        daemonReadyTimeoutMs: 1000,
      },
    );

    // Push the ready line so up proceeds to spawn webui.
    daemon.stdout!.push("scorel daemon serving url=ws://127.0.0.1:7800\n");
    await pollUntil(() => out.toString().includes("scorel up\n"));
    expect(out.toString()).toContain("daemon  ws://127.0.0.1:7800  token=auto-token");
    expect(out.toString()).toContain("webui   http://127.0.0.1:3100");
    expect(spawnCwds).toEqual(["/cli", "/cli"]);
    expect(spawnArgvs[0]).toEqual(expect.arrayContaining(["daemon", "serve", "--idle-timeout-ms", "900000"]));

    expect(daemon.unrefCalled).toBe(true);

    // Drive a clean shutdown via SIGINT propagation. `scorel up` only owns
    // WebUI; the singleton daemon must keep running in the background.
    expect(sigintHandler).toBeDefined();
    sigintHandler!();
    expect(daemon.killSignals).toEqual([]);
    expect(webui.killSignals).toContain("SIGTERM");
    webui.exit(0);
    await expect(upPromise).resolves.toBe(0);
    expect(out.toString()).toContain("scorel up stopped");
  });

  it("allows slow development daemon startup before timing out", async () => {
    vi.useFakeTimers();
    const daemon = makeChild();
    const webui = makeChild();
    let spawnCalls = 0;
    const spawnFn = (_command: string, argv: string[]) => {
      spawnCalls += 1;
      return (argv.includes("daemon") ? daemon : webui) as unknown as ReturnType<typeof import("node:child_process").spawn>;
    };
    const out = new StringWritable();
    const err = new StringWritable();
    let sigintHandler: (() => void) | undefined;

    const upPromise = runCliUp([], {
      output: out,
      error: err,
      stateDir: "/state",
      spawn: spawnFn,
      cliEntrypoint: "/cli/index.ts",
      readState: async () =>
        spawnCalls === 0
          ? null
          : {
              host: "127.0.0.1",
              port: 7777,
              wsUrl: "ws://127.0.0.1:7777",
              token: "tok",
              pid: 99,
              startedAt: 1,
              stoppedAt: null,
            },
      attachSigint: (handler) => {
        sigintHandler = handler;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(12_000);
    daemon.stdout!.push("scorel daemon serving url=ws://127.0.0.1:7777\n");
    await vi.waitFor(() => expect(out.toString()).toContain("scorel up\n"));
    expect(sigintHandler).toBeDefined();
    sigintHandler!();
    webui.exit(0);

    await expect(upPromise).resolves.toBe(0);
    expect(daemon.killSignals).toEqual([]);
    expect(err.toString()).toBe("");
  });

  it("does not stop the singleton daemon when webui dies unexpectedly", async () => {
    const daemon = makeChild();
    const webui = makeChild();
    let spawnCalls = 0;
    const spawnFn = (_command: string, argv: string[]) => {
      spawnCalls += 1;
      return (argv.includes("daemon") ? daemon : webui) as unknown as ReturnType<typeof import("node:child_process").spawn>;
    };

    const upPromise = runCliUp([], {
      output: new StringWritable(),
      error: new StringWritable(),
      stateDir: "/state",
      spawn: spawnFn,
      cliEntrypoint: "/cli/index.ts",
      readState: async () =>
        spawnCalls === 0
          ? null
          : {
              host: "127.0.0.1",
              port: 7777,
              wsUrl: "ws://127.0.0.1:7777",
              token: "tok",
              pid: 99,
              startedAt: 1,
              stoppedAt: null,
            },
      attachSigint: () => () => undefined,
      daemonReadyTimeoutMs: 1000,
    });
    daemon.stdout!.push("scorel daemon serving url=ws://127.0.0.1:7777\n");
    await pollUntil(() => spawnCalls >= 2);
    // Simulate webui crash: the daemon is now the singleton background host,
    // not a survivor owned by this `scorel up` process.
    webui.exit(2);
    expect(daemon.killSignals).toEqual([]);
    await expect(upPromise).resolves.toBe(1);
  });

  it("surfaces daemon stderr when the daemon exits before printing the ready line", async () => {
    const daemon = makeChild();
    let spawnCalls = 0;
    const spawnFn = (_command: string, _argv: string[]) => {
      spawnCalls += 1;
      return daemon as unknown as ReturnType<typeof import("node:child_process").spawn>;
    };

    const err = new StringWritable();
    const upPromise = runCliUp([], {
      output: new StringWritable(),
      error: err,
      stateDir: "/state",
      spawn: spawnFn,
      cliEntrypoint: "/cli/index.ts",
      readState: async () => null,
      attachSigint: () => () => undefined,
      daemonReadyTimeoutMs: 500,
    });

    daemon.stderr!.push("Error: SCOREL_API_KEY is not set\n");
    // Let the readable's data event flush before the exit listener tears
    // down the listeners.
    await new Promise((resolve) => setImmediate(resolve));
    daemon.exit(1);
    await expect(upPromise).resolves.toBe(1);
    expect(spawnCalls).toBe(1);
    const text = err.toString();
    expect(text).toContain("daemon exited before ready");
    expect(text).toContain("SCOREL_API_KEY is not set");
  });

  it("skips daemon spawn when daemon.json reports a running daemon", async () => {
    const webui = makeChild();
    let spawnCount = 0;
    const spawnFn = (_command: string, _argv: string[]) => {
      spawnCount += 1;
      return webui as unknown as ReturnType<typeof import("node:child_process").spawn>;
    };

    const out = new StringWritable();
    const upPromise = runCliUp([], {
      output: out,
      error: new StringWritable(),
      stateDir: "/state",
      spawn: spawnFn,
      cliEntrypoint: "/cli/index.ts",
      readState: async () => ({
        host: "127.0.0.1",
        port: 7777,
        wsUrl: "ws://127.0.0.1:7777",
        token: "existing",
        pid: process.pid, // alive → running
        startedAt: 1,
        stoppedAt: null,
      }),
      attachSigint: () => () => undefined,
      daemonReadyTimeoutMs: 500,
    });
    await pollUntil(() => out.toString().includes("scorel up"));
    expect(spawnCount).toBe(1); // only webui was spawned
    expect(out.toString()).toContain("token=existing");
    webui.exit(0);
    await expect(upPromise).resolves.toBe(0);
  });
});

const pollUntil = async (predicate: () => boolean, intervalMs = 5): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 3000) {
      throw new Error("pollUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
