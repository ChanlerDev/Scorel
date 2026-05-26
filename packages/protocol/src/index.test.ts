import { describe, expect, it } from "vitest";

import { protocolPackageName } from "@scorel/protocol";

describe("@scorel/protocol", () => {
  it("has a public entrypoint", () => {
    expect(protocolPackageName).toBe("@scorel/protocol");
  });
});
