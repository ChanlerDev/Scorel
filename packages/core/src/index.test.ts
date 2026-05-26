import { describe, expect, it } from "vitest";

import { corePackageName, coreProtocolDependency } from "@scorel/core";

describe("@scorel/core", () => {
  it("has a public entrypoint and imports protocol", () => {
    expect(corePackageName).toBe("@scorel/core");
    expect(coreProtocolDependency).toBe("@scorel/protocol");
  });
});
