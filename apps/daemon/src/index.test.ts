import { describe, expect, it } from "vitest";

import { daemonAppDependency, daemonAppName } from "@scorel/app-daemon";

describe("@scorel/app-daemon", () => {
  it("is an entrypoint shell over daemon", () => {
    expect(daemonAppName).toBe("@scorel/app-daemon");
    expect(daemonAppDependency).toBe("@scorel/daemon");
  });
});
