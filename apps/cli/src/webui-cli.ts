import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type WebUiCommandOptions = {
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  /**
   * Optional override; tests inject a fake spawner so they can assert on
   * argv, env, and cwd without booting Next.js.
   */
  spawn?: (command: string, argv: string[], opts: SpawnOptions) => ChildProcess;
  /**
   * Optional override for `apps/webui` resolution; tests pass an absolute
   * path so they don't depend on the real workspace layout.
   */
  webuiAppDir?: string;
};

export type WebUiSpawnPlan = {
  command: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

type WebUiFlags = {
  host: string;
  port: number;
};

export const runCliWebUi = async (
  argv: string[],
  options: WebUiCommandOptions,
): Promise<number> => {
  let flags: WebUiFlags;
  try {
    flags = parseWebUiFlags(argv);
  } catch (cause) {
    options.error.write(`scorel webui error: ${(cause as Error).message}\n`);
    return 1;
  }
  const webuiAppDir = options.webuiAppDir ?? findWebuiAppDir();
  if (!webuiAppDir) {
    options.error.write("scorel webui error: could not locate apps/webui\n");
    return 1;
  }
  const plan = buildWebUiSpawnPlan(flags, webuiAppDir);
  const spawnFn = options.spawn ?? spawn;
  const child = spawnFn(plan.command, plan.argv, {
    cwd: plan.cwd,
    env: plan.env,
    stdio: "inherit",
  });
  return await waitForChildExit(child, options);
};

/**
 * Locate the `apps/webui` package directory by walking up from the CLI
 * source location until we find a workspace root that contains it. Done
 * eagerly (synchronously) so spawn args are deterministic; the workspace
 * layout never changes inside a single process.
 */
const findWebuiAppDir = (): string | undefined => {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(cursor, "apps/webui/package.json");
    if (existsSync(candidate)) {
      return resolve(cursor, "apps/webui");
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) {
      return undefined;
    }
    cursor = parent;
  }
  return undefined;
};

export const buildWebUiSpawnPlan = (flags: WebUiFlags, webuiAppDir: string): WebUiSpawnPlan => {
  const env = {
    ...process.env,
    PORT: String(flags.port),
    HOST: flags.host,
  };
  // Prefer the directly-bundled Next CLI to avoid a recursive pnpm hop and to
  // keep the spawn graph small (parent → node → next, no shell).
  const nextBin = resolve(webuiAppDir, "node_modules/next/dist/bin/next");
  if (existsSync(nextBin)) {
    return {
      command: process.execPath,
      argv: [nextBin, "dev", "-p", String(flags.port), "-H", flags.host],
      cwd: webuiAppDir,
      env,
    };
  }
  // Fallback: pnpm filter command. Keeps the path working before
  // `pnpm install` has hydrated the inner node_modules.
  return {
    command: "pnpm",
    argv: ["--filter", "@scorel/app-webui", "dev"],
    cwd: webuiAppDir,
    env,
  };
};

const parseWebUiFlags = (argv: string[]): WebUiFlags => {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      host = requireValue(argv, index, "--host");
      index += 1;
      continue;
    }
    if (arg === "--port") {
      port = Number(requireValue(argv, index, "--port"));
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port must be an integer from 0 to 65535");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown webui option: ${arg}`);
  }
  return { host, port };
};

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const waitForChildExit = (
  child: ChildProcess,
  options: WebUiCommandOptions,
): Promise<number> =>
  new Promise((resolveExit) => {
    child.once("error", (cause) => {
      options.error.write(`scorel webui error: ${cause.message}\n`);
      resolveExit(1);
    });
    child.once("exit", (code) => {
      resolveExit(typeof code === "number" ? code : 1);
    });
  });
