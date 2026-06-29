import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Readable } from "node:stream";

import { createDevGuiPlan, runDevGui } from "./dev-gui.mjs";

test("createDevGuiPlan stops existing daemon, starts checkout Host, then launches GUI dev", () => {
  const plan = createDevGuiPlan({
    rootDir: "/repo",
    stateDir: "/home/.scorel",
    nodePath: "/node/bin/node",
    pnpmCommand: "pnpm",
  });

  assert.deepEqual(plan.stopDaemon, {
    command: "pnpm",
    args: ["scorel", "host", "stop"],
    cwd: "/repo",
  });
  assert.equal(plan.readDaemonStatePath, "/home/.scorel/daemon.json");
  assert.deepEqual(plan.startHost, {
    command: "pnpm",
    args: [
      "scorel",
      "host",
      "serve",
      "--port",
      "0",
      "--cwd",
      "/repo",
      "--lifetime",
      "attached",
      "--no-relay",
    ],
    cwd: "/repo",
  });
  assert.deepEqual(plan.startGui, {
    command: "pnpm",
    args: ["--filter", "@scorel/app-gui", "dev"],
    cwd: "/repo",
    env: {
      SCOREL_CLI_ENTRYPOINT: "/repo/apps/cli/src/index.ts",
      SCOREL_NODE_PATH: "/node/bin/node",
    },
  });
});

test("createDevGuiPlan can restore a previous user-started daemon through the installed scorel command", () => {
  const plan = createDevGuiPlan({
    rootDir: "/repo",
    stateDir: "/home/.scorel",
  });

  assert.deepEqual(
    plan.restoreDaemon({
      host: "127.0.0.1",
      port: 7777,
      token: "previous-token",
      launchIntent: "user_started",
    }),
    {
      command: "scorel",
      args: [
        "host",
        "start",
        "--host",
        "127.0.0.1",
        "--port",
        "7777",
        "--token",
        "previous-token",
        "--no-relay",
      ],
      cwd: "/repo",
    },
  );
  assert.equal(plan.restoreDaemon({ launchIntent: "attached" }), null);
});

test("runDevGui waits for Host readiness before launching GUI", async () => {
  const children = [];
  const calls = [];
  const codePromise = runDevGui({
    rootDir: "/repo",
    nodePath: "/node/bin/node",
    readFile: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    spawn: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    output: writableSink(),
    error: writableSink(),
  });

  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["scorel", "host", "stop"]);
  children[0].exit(1);
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args.slice(0, 4), ["scorel", "host", "serve", "--port"]);
  children[1].stdout.push("scorel host serving url=ws://127.0.0.1:7777\n");
  await tick();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].args, ["--filter", "@scorel/app-gui", "dev"]);
  assert.equal(calls[2].env.SCOREL_CLI_ENTRYPOINT, "/repo/apps/cli/src/index.ts");

  children[2].exit(0);
  await assert.doesNotReject(codePromise);
  assert.equal(await codePromise, 0);
});

test("runDevGui does not launch GUI when Host exits before ready", async () => {
  const children = [];
  const calls = [];
  const codePromise = runDevGui({
    rootDir: "/repo",
    nodePath: "/node/bin/node",
    readFile: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    spawn: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    output: writableSink(),
    error: writableSink(),
  });

  await tick();
  children[0].exit(0);
  await tick();
  children[1].stderr.push("host failed\n");
  children[1].exit(1);

  assert.equal(await codePromise, 1);
  assert.equal(calls.length, 2);
});

test("runDevGui stops dev Host when interrupted before GUI exits", async () => {
  const children = [];
  let signalHandler;
  const codePromise = runDevGui({
    rootDir: "/repo",
    nodePath: "/node/bin/node",
    readFile: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    attachSignalHandlers: (handler) => {
      signalHandler = handler;
      return () => undefined;
    },
    output: writableSink(),
    error: writableSink(),
  });

  await tick();
  children[0].exit(0);
  await tick();
  children[1].stdout.push("scorel host serving url=ws://127.0.0.1:7777\n");
  await tick();
  signalHandler();
  assert.deepEqual(children[1].killSignals, ["SIGTERM"]);
  assert.deepEqual(children[2].killSignals, ["SIGTERM"]);
  children[2].exit(143);

  assert.equal(await codePromise, 143);
});

test("runDevGui restores a previous user-started daemon after GUI exits", async () => {
  const children = [];
  const calls = [];
  const codePromise = runDevGui({
    rootDir: "/repo",
    stateDir: "/home/.scorel",
    readFile: async () => JSON.stringify({
      host: "127.0.0.1",
      port: 7777,
      wsUrl: "ws://127.0.0.1:7777",
      token: "previous-token",
      pid: 123,
      startedAt: 1,
      stoppedAt: null,
      launchIntent: "user_started",
    }),
    spawn: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    output: writableSink(),
    error: writableSink(),
  });

  await tick();
  children[0].exit(0);
  await tick();
  children[1].stdout.push("scorel host serving url=ws://127.0.0.1:7778\n");
  await tick();
  children[2].exit(0);
  await tick();
  assert.deepEqual(calls[3], {
    command: "scorel",
    args: ["host", "start", "--host", "127.0.0.1", "--port", "7777", "--token", "previous-token", "--no-relay"],
    cwd: "/repo",
  });
  children[3].exit(0);

  assert.equal(await codePromise, 0);
});

test("runDevGui does not restore a previous attach-owned daemon", async () => {
  const children = [];
  const calls = [];
  const codePromise = runDevGui({
    rootDir: "/repo",
    readFile: async () => JSON.stringify({ launchIntent: "attached" }),
    spawn: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    output: writableSink(),
    error: writableSink(),
  });

  await tick();
  children[0].exit(0);
  await tick();
  children[1].stdout.push("scorel host serving url=ws://127.0.0.1:7778\n");
  await tick();
  children[2].exit(0);

  assert.equal(await codePromise, 0);
  assert.equal(calls.length, 3);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.killSignals = [];
  child.kill = (signal = "SIGTERM") => {
    child.killSignals.push(signal);
    return true;
  };
  child.exit = (code) => {
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit("exit", code, null);
  };
  return child;
}

function writableSink() {
  return { write() {} };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
