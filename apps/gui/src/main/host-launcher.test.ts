import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHostStartInvocation, resolveHostLauncher } from "./host-launcher.js";

describe("GUI Host launcher", () => {
  it("uses the bundled scorel executable for packaged GUI startup without relying on PATH", () => {
    const launcher = resolveHostLauncher({
      isPackaged: true,
      resourcesPath: "/Applications/Scorel.app/Contents/Resources",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      appDistDir: "/Applications/Scorel.app/Contents/Resources/app.asar/.dist",
    });

    expect(launcher).toEqual({
      command: "/Applications/Scorel.app/Contents/Resources/scorel",
      prefixArgs: [],
      cwd: "/Applications/Scorel.app/Contents/Resources",
    });
  });

  it("keeps the source CLI entrypoint for development startup", () => {
    const appDistDir = join(process.cwd(), ".dist");
    const launcher = resolveHostLauncher({
      isPackaged: false,
      resourcesPath: join(process.cwd(), "release-dev-resources"),
      env: {
        SCOREL_NODE_PATH: "/opt/node/bin/node",
        SCOREL_CLI_ENTRYPOINT: "/repo/apps/cli/src/index.ts",
      },
      appDistDir,
    });

    expect(launcher).toEqual({
      command: "/opt/node/bin/node",
      prefixArgs: ["--import", "tsx", "/repo/apps/cli/src/index.ts"],
      cwd: "/repo/apps/cli/src",
    });
  });

  it("builds the host start invocation behind the shared launcher contract", () => {
    const invocation = buildHostStartInvocation({
      launcher: {
        command: "/Applications/Scorel.app/Contents/Resources/scorel",
        prefixArgs: [],
        cwd: "/Applications/Scorel.app/Contents/Resources",
      },
      bootstrapProject: "/Users/test/.scorel/workspace",
      idleTimeoutMs: 900_000,
    });

    expect(invocation).toEqual({
      command: "/Applications/Scorel.app/Contents/Resources/scorel",
      args: [
        "host",
        "start",
        "--port",
        "0",
        "--cwd",
        "/Users/test/.scorel/workspace",
        "--idle-timeout-ms",
        "900000",
        "--no-relay",
      ],
      cwd: "/Applications/Scorel.app/Contents/Resources",
    });
  });
});
