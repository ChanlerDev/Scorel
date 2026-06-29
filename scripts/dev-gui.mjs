import { spawn as spawnChild } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile as readFileDefault } from "node:fs/promises";

const defaultRootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const createDevGuiPlan = (options = {}) => {
  const rootDir = resolve(options.rootDir ?? defaultRootDir);
  const nodePath = options.nodePath ?? process.execPath;
  const pnpmCommand = options.pnpmCommand ?? "pnpm";
  const stateDir = resolve(options.stateDir ?? join(homedir(), ".scorel"));
  return {
    readDaemonStatePath: join(stateDir, "daemon.json"),
    stopDaemon: {
      command: pnpmCommand,
      args: ["scorel", "host", "stop"],
      cwd: rootDir,
    },
    startHost: {
      command: pnpmCommand,
      args: [
        "scorel",
        "host",
        "serve",
        "--port",
        "0",
        "--cwd",
        rootDir,
        "--lifetime",
        "attached",
        "--no-relay",
      ],
      cwd: rootDir,
    },
    startGui: {
      command: pnpmCommand,
      args: ["--filter", "@scorel/app-gui", "dev"],
      cwd: rootDir,
      env: {
        SCOREL_CLI_ENTRYPOINT: `${rootDir}/apps/cli/src/index.ts`,
        SCOREL_NODE_PATH: nodePath,
      },
    },
    restoreDaemon(state) {
      if (state?.launchIntent !== "user_started" || typeof state.host !== "string" || typeof state.port !== "number" || typeof state.token !== "string") {
        return null;
      }
      return {
        command: "scorel",
        args: [
          "host",
          "start",
          "--host",
          state.host,
          "--port",
          String(state.port),
          "--token",
          state.token,
          "--no-relay",
        ],
        cwd: rootDir,
      };
    },
  };
};

export const runDevGui = async (options = {}) => {
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const spawn = options.spawn ?? spawnChild;
  const readFile = options.readFile ?? readFileDefault;
  const plan = createDevGuiPlan(options);
  const previousDaemonState = await readPreviousDaemonState(plan.readDaemonStatePath, readFile);
  let hostChild;
  let guiChild;
  let shuttingDown = false;
  let restorePrevious = false;

  const stopDevHost = () => {
    if (hostChild && !hostChild.exitCode && !hostChild.killed) {
      hostChild.kill("SIGTERM");
    }
  };
  const stopGui = () => {
    if (guiChild && !guiChild.exitCode && !guiChild.killed) {
      guiChild.kill("SIGTERM");
    }
  };
  const detachSignals = (options.attachSignalHandlers ?? defaultAttachSignalHandlers)(() => {
    shuttingDown = true;
    stopGui();
    stopDevHost();
  });

  try {
    await runBestEffort(plan.stopDaemon, { spawn, output, error });
    hostChild = spawn(plan.startHost.command, plan.startHost.args, {
      cwd: plan.startHost.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipePrefixed(hostChild.stderr, "[host] ", error);
    await waitForReadyLine(hostChild, {
      readyText: ["scorel host serving url=", "scorel daemon serving url="],
      label: "dev Host",
    });
    guiChild = spawn(plan.startGui.command, plan.startGui.args, {
      cwd: plan.startGui.cwd,
      env: { ...process.env, ...plan.startGui.env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    const guiCode = await waitForExit(guiChild);
    if (guiCode !== 0 && !shuttingDown) {
      error.write(`scorel dev gui exited code=${guiCode}\n`);
    }
    restorePrevious = true;
    return guiCode;
  } catch (cause) {
    error.write(`scorel dev gui error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    stopGui();
    stopDevHost();
    return 1;
  } finally {
    detachSignals();
    if (restorePrevious || shuttingDown) {
      await restorePreviousDaemon(plan, previousDaemonState, { spawn, output, error });
    }
  }
};

const readPreviousDaemonState = async (path, readFile) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};

const restorePreviousDaemon = async (plan, state, options) => {
  const commandSpec = plan.restoreDaemon(state);
  if (!commandSpec) return;
  await runBestEffort(commandSpec, options);
};

const runBestEffort = async (commandSpec, options) => {
  const child = options.spawn(commandSpec.command, commandSpec.args, {
    cwd: commandSpec.cwd,
    env: { ...process.env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  pipePrefixed(child.stderr, "[stop] ", options.error);
  await waitForExit(child);
};

const waitForReadyLine = (child, options) =>
  new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      if (options.readyText.some((text) => stdout.includes(text))) {
        settle(resolveReady);
        return;
      }
      const newlineIndex = stdout.lastIndexOf("\n");
      stdout = newlineIndex >= 0 ? stdout.slice(newlineIndex + 1) : stdout;
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (cause) => {
      settle(() => rejectReady(cause));
    };
    const onExit = (code) => {
      const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
      settle(() => rejectReady(new Error(`${options.label} exited before ready code=${code ?? "unknown"}${detail}`)));
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });

const waitForExit = (child) =>
  new Promise((resolveExit) => {
    child.once("exit", (code) => resolveExit(typeof code === "number" ? code : 0));
  });

const pipePrefixed = (stream, prefix, destination) => {
  if (!stream || !destination) return;
  stream.on("data", (chunk) => {
    destination.write(`${prefix}${chunk.toString()}`);
  });
};

const defaultAttachSignalHandlers = (handler) => {
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDevGui();
}
