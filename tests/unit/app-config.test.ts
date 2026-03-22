import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getDefaultWorkspacePath,
  loadAppConfig,
  normalizePermissionConfig,
} from "../../src/main/app-config.js";

describe("app-config", () => {
  let tempDir: string;
  let fakeHomeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scorel-app-config-"));
    fakeHomeDir = path.join(tempDir, "home");
    fs.mkdirSync(fakeHomeDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a default config file and default workspace on first load", () => {
    const config = loadAppConfig(tempDir, { homeDir: fakeHomeDir });

    expect(config.defaultWorkspace).toBe(path.join(fakeHomeDir, "Scorel"));
    expect(fs.existsSync(path.join(tempDir, "app-config.json"))).toBe(true);
    expect(fs.existsSync(config.defaultWorkspace)).toBe(true);
  });

  it("loads an existing config file without overwriting it", () => {
    const existingWorkspace = path.join(tempDir, "custom-workspace");
    fs.mkdirSync(existingWorkspace, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "app-config.json"),
      JSON.stringify({ defaultWorkspace: existingWorkspace }),
      "utf8",
    );

    const config = loadAppConfig(tempDir, { homeDir: fakeHomeDir });

    expect(config.defaultWorkspace).toBe(existingWorkspace);
  });

  it("falls back to the default workspace when persisted config is invalid", () => {
    fs.writeFileSync(path.join(tempDir, "app-config.json"), "not-json", "utf8");

    const config = loadAppConfig(tempDir, { homeDir: fakeHomeDir });

    expect(config.defaultWorkspace).toBe(getDefaultWorkspacePath(fakeHomeDir));
    expect(fs.existsSync(config.defaultWorkspace)).toBe(true);
  });

  it("normalizes invalid permission config entries", () => {
    const config = normalizePermissionConfig({
      fullAccess: true,
      toolDefaults: {
        read_file: "allow",
        bash: "alllow",
        "filesystem.read": "deny",
      },
      denyReasons: {
        bash: "blocked",
        "filesystem.read": "sandboxed",
        read_file: 123,
      },
    });

    expect(config).toEqual({
      fullAccess: true,
      toolDefaults: {
        read_file: "allow",
        "filesystem.read": "deny",
      },
      denyReasons: {
        bash: "blocked",
        "filesystem.read": "sandboxed",
      },
    });
  });
});
