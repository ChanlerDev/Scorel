import { describe, expect, it } from "vitest";

import { daemonCoreDependency, daemonPackageName, daemonProtocolDependency } from "@scorel/daemon";

describe("@scorel/daemon", () => {
  it("has a public entrypoint and imports protocol/core", () => {
    expect(daemonPackageName).toBe("@scorel/daemon");
    expect(daemonProtocolDependency).toBe("@scorel/protocol");
    expect(daemonCoreDependency).toBe("@scorel/core");
  });
});
