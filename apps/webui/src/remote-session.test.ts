import { describe, expect, it } from "vitest";

import { asClientId, asDeviceId, asSeq, asSessionId, type ClientId, type SessionId } from "@scorel/protocol";

import { createRemoteSessionController, type ConnectToRemoteSession } from "./remote-session.js";

const testClientId = asClientId("webui_test");

const createConnect =
  (options?: { failWith?: Error; resyncMode?: "stream_resume" | "persistent_fallback" | "full_reload" }) => {
    const calls: Array<{ url: string; token: string; sessionId: SessionId; clientId: ClientId }> = [];
    const connect: ConnectToRemoteSession = async (input) => {
      calls.push(input);
      if (options?.failWith) {
        throw options.failWith;
      }
      return {
        client: {
          sessionId: input.sessionId,
          persistentLastSeq: asSeq(4),
          streamLastSeq: asSeq(7),
          resync: async () => ({
            mode: options?.resyncMode ?? "stream_resume",
            throughSeq: asSeq(7),
            events: [],
          }),
        },
        identity: {
          deviceId: asDeviceId("device_tokyo"),
          deviceDisplayName: "Tokyo VPS",
          projectSlug: "scorel",
        },
      };
    };
    return { connect, calls };
  };

describe("createRemoteSessionController", () => {
  it("starts disconnected without leaking input state", () => {
    const { connect } = createConnect();
    const controller = createRemoteSessionController({ clientId: testClientId, connect });

    expect(controller.getState()).toEqual({ status: "disconnected" });
  });

  it("connects, resyncs, and records daemon identity and anchors", async () => {
    const { connect, calls } = createConnect({ resyncMode: "persistent_fallback" });
    const controller = createRemoteSessionController({ clientId: testClientId, connect });

    await controller.connect({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: "ses_webui",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: asSessionId("ses_webui"),
      clientId: testClientId,
    });
    expect(controller.getState()).toEqual({
      status: "connected",
      sessionId: asSessionId("ses_webui"),
      identity: {
        deviceId: "device_tokyo",
        deviceDisplayName: "Tokyo VPS",
        projectSlug: "scorel",
      },
      persistentLastSeq: asSeq(4),
      streamLastSeq: asSeq(7),
      resyncMode: "persistent_fallback",
    });
  });

  it("redacts token values from failed connection status", async () => {
    const { connect } = createConnect({ failWith: new Error("auth failed for secret-token") });
    const controller = createRemoteSessionController({ clientId: testClientId, connect });

    await controller.connect({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: "ses_webui",
    });

    expect(controller.getState()).toEqual({
      status: "error",
      message: "auth failed for [redacted]",
    });
  });

  it("reconnects with the last connection input", async () => {
    const { connect, calls } = createConnect();
    const controller = createRemoteSessionController({ clientId: testClientId, connect });

    await controller.connect({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: "ses_webui",
    });
    await controller.reconnect();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: asSessionId("ses_webui"),
      clientId: testClientId,
    });
  });
});
