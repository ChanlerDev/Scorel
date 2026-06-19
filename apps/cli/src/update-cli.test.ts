import { describe, expect, it } from "vitest";

import { compareSemver, createNpmPackageUpdater, shouldRunAutoUpdate } from "./update-cli.js";

describe("scorel update helpers", () => {
  it("orders semver versions without lexicographic traps", () => {
    expect(compareSemver("0.0.9", "0.0.10")).toBeLessThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("checks npm latest and installs the package when an update is available", async () => {
    const commands: Array<{ command: string; argv: string[] }> = [];
    const updater = createNpmPackageUpdater({
      packageName: "@chanlerdev/scorel",
      currentVersion: "0.0.4",
      execFile: async (command, argv) => {
        commands.push({ command, argv });
        if (argv.join(" ") === "view @chanlerdev/scorel version") {
          return { stdout: "0.0.5\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    });

    const result = await updater.update();

    expect(result).toEqual({ status: "updated", currentVersion: "0.0.4", latestVersion: "0.0.5" });
    expect(commands).toEqual([
      { command: "npm", argv: ["view", "@chanlerdev/scorel", "version"] },
      { command: "npm", argv: ["install", "-g", "@chanlerdev/scorel@0.0.5"] },
    ]);
  });

  it("skips install when npm latest is not newer", async () => {
    const commands: Array<{ command: string; argv: string[] }> = [];
    const updater = createNpmPackageUpdater({
      packageName: "@chanlerdev/scorel",
      currentVersion: "0.0.4",
      execFile: async (command, argv) => {
        commands.push({ command, argv });
        return { stdout: "0.0.4\n", stderr: "" };
      },
    });

    await expect(updater.update()).resolves.toEqual({ status: "current", currentVersion: "0.0.4", latestVersion: "0.0.4" });
    expect(commands).toEqual([{ command: "npm", argv: ["view", "@chanlerdev/scorel", "version"] }]);
  });

  it("allows auto update only when work is idle or stale for three hours", () => {
    const now = Date.UTC(2026, 5, 19, 12);

    expect(shouldRunAutoUpdate({ activeWork: false, lastActiveWorkAt: now - 1, now })).toBe(true);
    expect(shouldRunAutoUpdate({ activeWork: true, lastActiveWorkAt: now - 2 * 60 * 60 * 1000, now })).toBe(false);
    expect(shouldRunAutoUpdate({ activeWork: true, lastActiveWorkAt: now - 3 * 60 * 60 * 1000, now })).toBe(true);
  });
});
