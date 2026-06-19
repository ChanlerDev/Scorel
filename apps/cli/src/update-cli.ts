import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const SCOREL_PACKAGE_NAME = "@chanlerdev/scorel";
export const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const ACTIVE_WORK_STALE_MS = 3 * 60 * 60 * 1000;

const execFileAsync = promisify(execFileCallback);

export type ExecFile = (command: string, argv: string[]) => Promise<{ stdout: string; stderr: string }>;

export type PackageUpdateResult =
  | { status: "current"; currentVersion: string; latestVersion: string }
  | { status: "updated"; currentVersion: string; latestVersion: string };

export type PackageUpdater = {
  checkLatest(): Promise<string>;
  update(): Promise<PackageUpdateResult>;
};

export type AutoUpdateActivity = {
  activeWork: boolean;
  lastActiveWorkAt: number;
  now: number;
};

export const compareSemver = (a: string, b: string): number => {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    const delta = left[index] - right[index];
    if (delta !== 0) return delta;
  }
  return 0;
};

export const shouldRunAutoUpdate = (activity: AutoUpdateActivity): boolean =>
  !activity.activeWork || activity.now - activity.lastActiveWorkAt >= ACTIVE_WORK_STALE_MS;

export const createNpmPackageUpdater = (options: {
  packageName?: string;
  currentVersion: string;
  execFile?: ExecFile;
}): PackageUpdater => {
  const packageName = options.packageName ?? SCOREL_PACKAGE_NAME;
  const execFile = options.execFile ?? ((command, argv) => execFileAsync(command, argv));
  return {
    async checkLatest() {
      const result = await execFile("npm", ["view", packageName, "version"]);
      const latest = result.stdout.trim();
      if (!latest) {
        throw new Error(`npm did not return a latest version for ${packageName}`);
      }
      parseSemver(latest);
      return latest;
    },
    async update() {
      const latestVersion = await this.checkLatest();
      if (compareSemver(options.currentVersion, latestVersion) >= 0) {
        return { status: "current", currentVersion: options.currentVersion, latestVersion };
      }
      await execFile("npm", ["install", "-g", `${packageName}@${latestVersion}`]);
      return { status: "updated", currentVersion: options.currentVersion, latestVersion };
    },
  };
};

export const readInstalledScorelVersion = async (): Promise<string> => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
    join(process.cwd(), "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as { name?: string; version?: string };
      if (typeof parsed.version === "string" && (parsed.name === SCOREL_PACKAGE_NAME || parsed.name === "@scorel/app-cli")) {
        return parsed.version;
      }
    } catch {
      // Try the next likely package root.
    }
  }
  return "0.0.0";
};

export const runCliUpdate = async (
  argv: string[],
  io: { output: NodeJS.WritableStream; error: NodeJS.WritableStream },
  options: { currentVersion?: string; updater?: PackageUpdater } = {},
): Promise<number> => {
  if (argv.includes("--help") || argv.includes("-h")) {
    writeUpdateUsage(io.output);
    return 0;
  }
  if (argv.length > 0) {
    writeUpdateUsage(io.error);
    return 1;
  }
  const currentVersion = options.currentVersion ?? await readInstalledScorelVersion();
  const updater = options.updater ?? createNpmPackageUpdater({ currentVersion });
  try {
    const result = await updater.update();
    if (result.status === "current") {
      io.output.write(`scorel is current (${result.currentVersion})\n`);
    } else {
      io.output.write(`updated scorel ${result.currentVersion} -> ${result.latestVersion}\n`);
    }
    return 0;
  } catch (cause) {
    io.error.write(`scorel update error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
};

export const writeUpdateUsage = (output: NodeJS.WritableStream): void => {
  output.write("Usage: scorel update\n       scorel upgrade\n");
};

const parseSemver = (version: string): [number, number, number] => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};
