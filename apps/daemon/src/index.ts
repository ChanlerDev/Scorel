import { daemonPackageName } from "@scorel/daemon";
import { homedir } from "node:os";
import { join } from "node:path";

import { createLocalDaemonState, readLocalDaemonState, removeLocalDaemonState } from "@scorel/daemon";

export const daemonAppName = "@scorel/app-daemon" as const;
export const daemonAppDependency = daemonPackageName;

export type DaemonCommandIo = {
  output: { write(chunk: string): void };
  error: { write(chunk: string): void };
};

export type DaemonCommandOptions = DaemonCommandIo & {
  stateDir?: string;
};

const defaultStateDir = (): string => join(homedir(), ".scorel");

export const runDaemonCommand = async (
  argv: string[],
  options: DaemonCommandOptions = { output: process.stdout, error: process.stderr },
): Promise<number> => {
  const [command] = argv;
  if (command === "start") {
    const stateDir = options.stateDir ?? defaultStateDir();
    const existing = await readLocalDaemonState({ stateDir });
    if (existing) {
      options.error.write(`scorel daemon already running pid=${existing.pid}\n`);
      return 1;
    }
    const state = await createLocalDaemonState({
      stateDir,
      pid: process.pid,
      socketPath: join(stateDir, "daemon.sock"),
      token: `local-${Date.now()}`,
      startedAt: Date.now(),
    });
    options.output.write(`scorel daemon started pid=${state.pid} socket=${state.socketPath}\n`);
    return 0;
  }
  if (command === "status") {
    const state = await readLocalDaemonState({ stateDir: options.stateDir ?? defaultStateDir() });
    if (!state) {
      options.error.write("scorel daemon stopped\n");
      return 1;
    }
    options.output.write(`scorel daemon running pid=${state.pid} socket=${state.socketPath}\n`);
    return 0;
  }
  if (command === "stop") {
    const stateDir = options.stateDir ?? defaultStateDir();
    const state = await readLocalDaemonState({ stateDir });
    if (!state) {
      options.error.write("scorel daemon stopped\n");
      return 1;
    }
    await removeLocalDaemonState({ stateDir });
    options.output.write("scorel daemon stopped\n");
    return 0;
  }
  options.error.write("Usage: scorel-daemon start|status|stop\n");
  return command === "--help" || command === "-h" ? 0 : 1;
};
