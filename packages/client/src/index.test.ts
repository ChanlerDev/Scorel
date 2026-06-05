import { describe, expect, it } from "vitest";

import { clientPackageName, clientProtocolDependency, RelayTransport } from "@scorel/client";

describe("@scorel/client", () => {
  it("has a public entrypoint and imports protocol", () => {
    expect(clientPackageName).toBe("@scorel/client");
    expect(clientProtocolDependency).toBe("@scorel/protocol");
    expect(RelayTransport).toBeTypeOf("function");
  });
});
