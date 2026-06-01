import { describe, expect, it } from "vitest";
import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSessionId,
  type ClientMessage,
  type ConnectParams,
  type ConnectResult,
  type DaemonMessage,
  type DaemonTransport,
  type Unsubscribe,
} from "@scorel/protocol";

import { DaemonClient, TransportDisconnectedError } from "./index.js";

/**
 * Transport that simulates the WsTransport behavior in S0045: synchronous
 * throws from `send()` when the socket is not in OPEN state. We need to make
 * sure the public DaemonClient surface never lets a sync throw escape into
 * the caller's stack — they must come back as a rejected Promise carrying
 * `TransportDisconnectedError`.
 */
class DeadTransport implements DaemonTransport {
  async connect(_params: ConnectParams): Promise<ConnectResult> {
    return { clientId: asClientId("client_dead"), currentSeq: 0 as ConnectResult["currentSeq"], deviceId: asDeviceId("device_dead") };
  }
  send(_message: ClientMessage): void {
    throw new Error("WsTransport is not connected");
  }
  onMessage(_handler: (message: DaemonMessage) => void): Unsubscribe {
    return () => {};
  }
  close(): void {}
}

class HalfDeadTransport implements DaemonTransport {
  #handler: ((message: DaemonMessage) => void) | undefined;
  #connected = false;
  async connect(_params: ConnectParams): Promise<ConnectResult> {
    this.#connected = true;
    return {
      clientId: asClientId("client_dead"),
      currentSeq: 0 as ConnectResult["currentSeq"],
      deviceId: asDeviceId("device_dead"),
    };
  }
  send(_message: ClientMessage): void {
    if (!this.#connected) throw new Error("WsTransport is not connected");
    this.#connected = false;
    throw new Error("WsTransport is not connected");
  }
  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe {
    this.#handler = handler;
    return () => (this.#handler = undefined);
  }
  close(): void {
    this.#connected = false;
  }
}

describe("TransportDisconnectedError", () => {
  it("is exported with a stable code property", () => {
    const err = new TransportDisconnectedError("boom");
    expect(err.code).toBe("transport_disconnected");
    expect(err.name).toBe("TransportDisconnectedError");
    expect(err).toBeInstanceOf(Error);
  });

  it("instanceof check works for consumers", () => {
    const err: unknown = new TransportDisconnectedError("boom");
    expect(err instanceof TransportDisconnectedError).toBe(true);
  });
});

describe("DaemonClient transport-disconnected guard", () => {
  it("sendMessage rejects with TransportDisconnectedError when transport is dead", async () => {
    const client = new DaemonClient(new HalfDeadTransport(), {
      clientId: asClientId("client_t1"),
      createRequestId: () => asRequestId("req_t1"),
    });
    await client.connect(asSessionId("ses_t1"));
    await expect(client.sendMessage("hi")).rejects.toBeInstanceOf(
      TransportDisconnectedError,
    );
    try {
      await client.sendMessage("hi");
    } catch (cause) {
      expect((cause as TransportDisconnectedError).code).toBe(
        "transport_disconnected",
      );
    }
  });

  it("cancel rejects with TransportDisconnectedError when transport is dead", async () => {
    const client = new DaemonClient(new HalfDeadTransport(), {
      clientId: asClientId("client_t2"),
      createRequestId: () => asRequestId("req_t2"),
    });
    await client.connect(asSessionId("ses_t2"));
    await expect(client.cancel()).rejects.toBeInstanceOf(
      TransportDisconnectedError,
    );
  });

  it("resync rejects with TransportDisconnectedError when transport is dead", async () => {
    const client = new DaemonClient(new HalfDeadTransport(), {
      clientId: asClientId("client_t3"),
      createRequestId: () => asRequestId("req_t3"),
    });
    await client.connect(asSessionId("ses_t3"));
    await expect(client.resync()).rejects.toBeInstanceOf(
      TransportDisconnectedError,
    );
  });

  it("does not let a sync throw escape into the caller stack", async () => {
    const client = new DaemonClient(new DeadTransport(), {
      clientId: asClientId("client_t4"),
      createRequestId: () => asRequestId("req_t4"),
    });
    await client.connect(asSessionId("ses_t4"));
    // Calling without `await` must not throw synchronously.
    let escaped: unknown;
    let promise: Promise<unknown>;
    try {
      promise = client.sendMessage("hi");
    } catch (cause) {
      escaped = cause;
      promise = Promise.resolve();
    }
    expect(escaped).toBeUndefined();
    await expect(promise).rejects.toBeInstanceOf(TransportDisconnectedError);
  });

  it("disconnect tolerates an already-closed transport", async () => {
    const client = new DaemonClient(new HalfDeadTransport(), {
      clientId: asClientId("client_t5"),
    });
    await client.connect(asSessionId("ses_t5"));
    // Should not throw — disconnect is fire-and-forget cleanup.
    expect(() => client.disconnect()).not.toThrow();
  });
});
