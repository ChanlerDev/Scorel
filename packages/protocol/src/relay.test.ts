import { describe, expect, it } from "vitest";

import {
  asClientId,
  asDeviceId,
  asRequestId,
  type RelayEntryFrame,
  type RelayHostFrame,
  type RelayResponse,
} from "./index.js";

describe("relay protocol exports", () => {
  it("defines Entry and Host frames around existing daemon wire payloads", () => {
    const entryFrame: RelayEntryFrame = {
      type: "entry_to_device",
      deviceId: asDeviceId("device_1"),
      payload: { type: "ping", requestId: asRequestId("req_1") },
    };
    const hostFrame: RelayHostFrame = {
      type: "host_to_entry",
      clientId: asClientId("client_1"),
      payload: { type: "pong", requestId: asRequestId("req_1") },
    };
    const response: RelayResponse = {
      type: "relay_response",
      requestId: asRequestId("relay_req_1"),
      ok: true,
      data: { clientId: asClientId("client_1") },
    };

    expect(entryFrame.payload.type).toBe("ping");
    expect(hostFrame.payload.type).toBe("pong");
    expect(response.ok).toBe(true);
  });
});
