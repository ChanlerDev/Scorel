import { describe, expect, it } from "vitest";

import {
  asClientId,
  asDeviceId,
  asEventId,
  asSeq,
  asSessionId,
  type ClientId,
  type ScorelEvent,
  type SessionId,
} from "@scorel/protocol";

import { createRemoteSessionController, type ConnectToRemoteSession } from "./remote-session.js";

const testClientId = asClientId("webui_test");

const createConnect =
  (options?: { failWith?: Error; resyncMode?: "stream_resume" | "persistent_fallback" | "full_reload" }) => {
    const calls: Array<{ url: string; token: string; sessionId?: SessionId; clientId: ClientId }> = [];
    const connect: ConnectToRemoteSession = async (input) => {
      calls.push(input);
      if (options?.failWith) {
        throw options.failWith;
      }
      const connectedSessionId = input.sessionId ?? null;
      const listedSessionId = input.sessionId ?? asSessionId("ses_webui");
      const requireSession = (): SessionId => {
        if (!connectedSessionId) {
          throw new Error("DaemonClient is not connected to a session");
        }
        return connectedSessionId;
      };
      return {
        client: {
          sessionId: connectedSessionId,
          persistentLastSeq: asSeq(4),
          streamLastSeq: asSeq(7),
          sendMessage: async (content) => ({
            sessionId: requireSession(),
            userEventId: asEventId(typeof content === "string" ? "evt_sent_user" : "evt_sent_blocks"),
            assistantEventId: asEventId("evt_sent_assistant"),
          }),
          cancel: async () => ({
            sessionId: requireSession(),
            cancelled: true,
          }),
          listSessions: async () => [
            {
              sessionId: listedSessionId,
              title: "Remote web session",
              model: "test-model",
              updatedAt: 7,
              currentSeq: asSeq(7),
            },
          ],
          loadSession: async (sessionId) => ({
            sessionId,
            activeLeafId: asEventId("evt_resynced"),
            currentSeq: asSeq(6),
            events: [
              {
                type: "user_message",
                id: asEventId("evt_resynced"),
                parentId: null,
                seq: asSeq(6),
                sessionId,
                clientId: input.clientId,
                ts: 6,
                message: { role: "user", content: [{ type: "text", text: "Recovered prompt" }] },
              },
            ],
            meta: { title: "Remote web session", model: "test-model" },
          }),
          resync: async () => ({
            mode: options?.resyncMode ?? "stream_resume",
            throughSeq: asSeq(7),
            events: [
              {
                type: "user_message",
                id: asEventId("evt_resynced"),
                parentId: null,
                seq: asSeq(6),
                sessionId: requireSession(),
                clientId: input.clientId,
                ts: 6,
                message: { role: "user", content: [{ type: "text", text: "Recovered prompt" }] },
              },
            ],
          }),
          subscribe: (handler: (event: ScorelEvent) => void) => {
            if (!connectedSessionId) {
              return () => undefined;
            }
            handler({
              type: "assistant_message",
              id: asEventId("evt_live"),
              parentId: asEventId("evt_resynced"),
              seq: asSeq(7),
              sessionId: connectedSessionId,
              clientId: input.clientId,
              ts: 7,
              message: { role: "assistant", content: [{ type: "text", text: "Live response" }] },
            });
            return () => undefined;
          },
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
      syncIndex: {
        remoteId: "remote",
        projects: [
          {
            projectKey: "remote:device_tokyo:scorel",
            displayName: "scorel",
            remoteLabel: "Tokyo VPS",
            sessions: [
              {
                sessionId: asSessionId("ses_webui"),
                title: "Remote web session",
                model: "test-model",
                updatedAt: 7,
                currentSeq: asSeq(7),
              },
            ],
          },
        ],
      },
      events: [
        expect.objectContaining({
          id: "evt_resynced",
          text: "Recovered prompt",
        }),
        expect.objectContaining({
          id: "evt_live",
          text: "Live response",
        }),
      ],
      composer: {
        status: "idle",
        message: "Ready",
      },
      sessionBrowser: {
        projectSlug: "scorel",
        projects: [
          {
            projectKey: "remote:device_tokyo:scorel",
            displayName: "scorel",
            remoteLabel: "Tokyo VPS",
            sessions: [
              {
                sessionId: asSessionId("ses_webui"),
                title: "Remote web session",
                model: "test-model",
                updatedAt: 7,
                currentSeq: asSeq(7),
              },
            ],
          },
        ],
        selectedProjectKey: "remote:device_tokyo:scorel",
        sessions: [
          expect.objectContaining({
            sessionId: asSessionId("ses_webui"),
            title: "Remote web session",
          }),
        ],
        selectedSessionId: asSessionId("ses_webui"),
        tree: [
          expect.objectContaining({
            id: "evt_resynced",
            text: "Recovered prompt",
            isActiveLeaf: true,
          }),
        ],
      },
    });
  });

  it("connects remote identity and session index without loading content before selection", async () => {
    const { connect, calls } = createConnect();
    const controller = createRemoteSessionController({ clientId: testClientId, connect });

    await controller.connect({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
    });

    expect(calls[0]).toMatchObject({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      clientId: testClientId,
    });
    expect(calls[0]?.sessionId).toBeUndefined();
    expect(controller.getState()).toMatchObject({
      status: "connected",
      sessionId: null,
      syncIndex: {
        projects: [
          {
            projectKey: "remote:device_tokyo:scorel",
            sessions: [
              expect.objectContaining({
                sessionId: asSessionId("ses_webui"),
              }),
            ],
          },
        ],
      },
      sessionBrowser: {
        selectedProjectKey: "remote:device_tokyo:scorel",
        selectedSessionId: null,
        tree: [],
      },
      events: [],
    });

    await controller.loadSession(asSessionId("ses_webui"));

    expect(controller.getState()).toMatchObject({
      status: "connected",
      sessionId: asSessionId("ses_webui"),
      sessionBrowser: {
        selectedSessionId: asSessionId("ses_webui"),
        tree: [
          expect.objectContaining({
            id: "evt_resynced",
          }),
        ],
      },
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

  it("sends prompts and cancels through the connected client", async () => {
    const { connect } = createConnect();
    const controller = createRemoteSessionController({ clientId: testClientId, connect });

    await controller.connect({
      url: "ws://127.0.0.1:5050",
      token: "secret-token",
      sessionId: "ses_webui",
    });

    await expect(controller.sendPrompt("Continue the task")).resolves.toMatchObject({
      status: "connected",
      composer: { status: "sent", message: "Prompt sent" },
    });
    await expect(controller.cancel()).resolves.toMatchObject({
      status: "connected",
      composer: { status: "cancelled", message: "Cancel requested" },
    });
  });
});
