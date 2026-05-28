import { describe, expect, it } from "vitest";

import { NodeSocketTransport, nodeClientEntrypoint } from "./index.js";

describe("@scorel/client/node", () => {
  it("reserves a Node-only socket transport entrypoint", () => {
    const transport = new NodeSocketTransport({ path: "/tmp/scorel-test.sock" });

    expect(nodeClientEntrypoint).toBe("@scorel/client/node");
    expect(transport.path).toBe("/tmp/scorel-test.sock");
  });
});
