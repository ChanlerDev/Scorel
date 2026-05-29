import { describe, expect, it } from "vitest";

import {
  asClientId,
  asDeviceId,
  asEventId,
  asRequestId,
  asSeq,
  asSessionId,
  okResponse,
  protocolPackageName,
  protocolVersion,
  type ClientRequest,
  type DaemonMessage,
  type ResponseFor,
  type ScorelEvent,
} from "@scorel/protocol";

describe("@scorel/protocol", () => {
  it("has a public entrypoint", () => {
    expect(protocolPackageName).toBe("@scorel/protocol");
    expect(protocolVersion).toBe(1);
  });

  it("pairs request and response data by request type", () => {
    const request = {
      type: "send_message",
      requestId: asRequestId("req_1"),
      sessionId: asSessionId("ses_1"),
      content: "hello",
    } satisfies ClientRequest<"send_message">;

    const response = okResponse(request, {
      userEventId: asEventId("evt_user"),
      assistantEventId: asEventId("evt_assistant"),
    }) satisfies ResponseFor<typeof request>;

    expect(response.requestType).toBe("send_message");
    expect(response.data.userEventId).toBe("evt_user");
  });

  it("rejects mismatched request/response pairs at type level", () => {
    const request = {
      type: "list_sessions",
      requestId: asRequestId("req_2"),
    } satisfies ClientRequest<"list_sessions">;

    okResponse(request, { sessions: [] });

    // @ts-expect-error list_sessions must not return send_message response data.
    okResponse(request, { userEventId: asEventId("evt_user"), assistantEventId: asEventId("evt_assistant") });
  });

  it("supports exhaustive event handling", () => {
    const event = {
      type: "text_delta",
      seq: asSeq(1),
      sessionId: asSessionId("ses_1"),
      clientId: asClientId("cli_1"),
      ts: 1,
      eventId: asEventId("evt_1"),
      delta: "hi",
    } satisfies ScorelEvent;

    const describeEvent = (input: ScorelEvent): string => {
      switch (input.type) {
        case "session_header":
          return "session_header";
        case "user_message":
          return input.message.role;
        case "assistant_message":
          return input.message.role;
        case "tool_result":
          return input.message.role;
        case "turn_start":
          return "turn_start";
        case "turn_end":
          return "turn_end";
        case "message_start":
          return input.role;
        case "message_end":
          return "message_end";
        case "text_delta":
          return input.delta;
        case "error":
          return input.code;
        default: {
          const exhaustive: never = input;
          return exhaustive;
        }
      }
    };

    expect(describeEvent(event)).toBe("hi");
  });

  it("keeps daemon messages on stable error codes", () => {
    const message = {
      type: "error",
      ok: false,
      code: "invalid_request",
      message: "Invalid request",
    } satisfies DaemonMessage;

    expect(message.code).toBe("invalid_request");
  });

  it("models resync with dual anchors and explicit recovery mode", () => {
    const request = {
      type: "resync_events",
      requestId: asRequestId("req_resync"),
      sessionId: asSessionId("ses_1"),
      persistentLastSeq: asSeq(2),
      streamLastSeq: asSeq(5),
    } satisfies ClientRequest<"resync_events">;

    const response = okResponse(request, {
      events: [],
      throughSeq: asSeq(2),
      mode: "persistent_fallback",
      gapFromSeq: asSeq(3),
      gapToSeq: asSeq(5),
    }) satisfies ResponseFor<typeof request>;

    expect(response.data.mode).toBe("persistent_fallback");
    expect(response.data.throughSeq).toBe(2);
  });

  it("models daemon connection identity for remote project cache scope", () => {
    const message = {
      type: "connected",
      clientId: asClientId("client_1"),
      sessionId: asSessionId("ses_1"),
      currentSeq: asSeq(0),
      deviceId: asDeviceId("device_tokyo"),
      deviceDisplayName: "Tokyo VPS",
      projectSlug: "scorel",
    } satisfies DaemonMessage;

    expect(message.deviceId).toBe("device_tokyo");
    expect(message.projectSlug).toBe("scorel");
  });
});
