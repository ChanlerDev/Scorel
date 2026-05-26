import { describe, expect, it } from "vitest";

import { cliAppName, cliClientDependency, cliDaemonDependency } from "@scorel/app-cli";

describe("@scorel/app-cli", () => {
  it("is an entrypoint shell over client/daemon", () => {
    expect(cliAppName).toBe("@scorel/app-cli");
    expect(cliClientDependency).toBe("@scorel/client");
    expect(cliDaemonDependency).toBe("@scorel/daemon");
  });
});
