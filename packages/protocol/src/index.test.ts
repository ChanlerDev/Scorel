import { describe, expect, it } from "vitest";

import {
  asClientId,
  asDeviceId,
  asEventId,
  asProjectId,
  asRequestId,
  asSeq,
  asSessionId,
  okResponse,
  protocolPackageName,
  protocolVersion,
  type ClientRequest,
  type CreateSessionMeta,
  type DaemonMessage,
  type DirectoryListing,
  type ErrorCode,
  type HostProject,
  type ResponseFor,
  type ScorelEvent,
  type SessionHeaderEvent,
  type SessionMeta,
  type SessionSummary,
} from "@scorel/protocol";

describe("@scorel/protocol", () => {
  it("has a public entrypoint", () => {
    expect(protocolPackageName).toBe("@scorel/protocol");
    expect(protocolVersion).toBe(2);
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
        case "instruction_snapshot":
          return input.snapshot.cwd;
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

  it("models connected handshake with device identity only", () => {
    const message = {
      type: "connected",
      clientId: asClientId("client_1"),
      sessionId: asSessionId("ses_1"),
      currentSeq: asSeq(0),
      deviceId: asDeviceId("device_tokyo"),
      deviceDisplayName: "Tokyo VPS",
    } satisfies DaemonMessage;

    expect(message.deviceId).toBe("device_tokyo");
  });

  it("round-trips cancel request and response", () => {
    const request = {
      type: "cancel",
      requestId: asRequestId("req_cancel"),
      sessionId: asSessionId("ses_cancel"),
    } satisfies ClientRequest<"cancel">;

    const response = okResponse(request, {
      sessionId: asSessionId("ses_cancel"),
      cancelled: true,
    }) satisfies ResponseFor<typeof request>;

    expect(response.requestType).toBe("cancel");
    expect(response.data.cancelled).toBe(true);
    expect(response.data.sessionId).toBe("ses_cancel");
  });

  it("round-trips list_sessions with projectId filter and limit clamp", () => {
    const request = {
      type: "list_sessions",
      requestId: asRequestId("req_list_sessions"),
      projectId: asProjectId("prj_repo"),
      limit: 50,
    } satisfies ClientRequest<"list_sessions">;

    const summary: SessionSummary = {
      sessionId: asSessionId("ses_alpha"),
      projectId: asProjectId("prj_repo"),
      title: "Alpha",
      model: "test-model",
      updatedAt: 5,
      currentSeq: asSeq(7),
    };
    const response = okResponse(request, { sessions: [summary] }) satisfies ResponseFor<typeof request>;

    expect(response.requestType).toBe("list_sessions");
    expect(response.data.sessions[0].projectId).toBe("prj_repo");
    expect(request.limit).toBe(50);
  });

  it("round-trips list_projects with Registry HostProject entries", () => {
    const request = {
      type: "list_projects",
      requestId: asRequestId("req_list_projects"),
    } satisfies ClientRequest<"list_projects">;

    const project: HostProject = {
      projectId: asProjectId("prj_repo"),
      displayName: "repo",
      workDir: "/Users/test/repo",
      createdAt: 90,
      updatedAt: 99,
    };
    const response = okResponse(request, { projects: [project] }) satisfies ResponseFor<typeof request>;

    expect(response.requestType).toBe("list_projects");
    expect(response.data.projects[0].displayName).toBe("repo");
    expect(response.data.projects[0].workDir).toBe("/Users/test/repo");
  });

  it("requires project identity in session metadata", () => {
    const meta: CreateSessionMeta = { projectId: asProjectId("prj_repo"), title: "Repo session" };
    const request = {
      type: "create_session",
      requestId: asRequestId("req_create_session"),
      meta,
    } satisfies ClientRequest<"create_session">;

    expect(request.meta.projectId).toBe("prj_repo");

    const missingProjectId: ClientRequest<"create_session"> = {
      type: "create_session",
      requestId: asRequestId("req_invalid"),
      // @ts-expect-error projectId is mandatory for every new session.
      meta: {},
    };
    expect(missingProjectId.meta).toEqual({});
  });

  it("round-trips project identity in session headers", () => {
    const meta: SessionMeta = { projectId: asProjectId("prj_repo") };
    const event: SessionHeaderEvent = {
      type: "session_header",
      protocolVersion: 2,
      id: asEventId("evt_header"),
      parentId: null,
      seq: asSeq(0),
      sessionId: asSessionId("ses_repo"),
      clientId: asClientId("cli_repo"),
      ts: 1,
      meta,
    };

    expect(event.meta.projectId).toBe("prj_repo");
  });

  it("exposes structured project registry and filesystem errors", () => {
    const errorCodes = [
      "project_not_found",
      "project_has_sessions",
      "filesystem_error",
    ] satisfies ErrorCode[];

    expect(errorCodes).toEqual(["project_not_found", "project_has_sessions", "filesystem_error"]);
  });

  it("round-trips directory listing and project registry requests", () => {
    const listing: DirectoryListing = {
      path: "/Users/test",
      parentPath: "/Users",
      entries: [{ name: "repo", path: "/Users/test/repo", kind: "directory" }],
    };
    const listDirectories = {
      type: "list_directories",
      requestId: asRequestId("req_list_directories"),
      path: "/Users/test",
    } satisfies ClientRequest<"list_directories">;
    const registerProject = {
      type: "register_project",
      requestId: asRequestId("req_register_project"),
      workDir: "/Users/test/repo",
    } satisfies ClientRequest<"register_project">;
    const removeProject = {
      type: "remove_project",
      requestId: asRequestId("req_remove_project"),
      projectId: asProjectId("prj_repo"),
    } satisfies ClientRequest<"remove_project">;

    expect(okResponse(listDirectories, listing).data.entries[0].kind).toBe("directory");
    expect(okResponse(registerProject, {
      project: {
        projectId: asProjectId("prj_repo"),
        displayName: "repo",
        workDir: "/Users/test/repo",
        createdAt: 1,
        updatedAt: 1,
      },
    }).data.project.projectId).toBe("prj_repo");
    expect(okResponse(removeProject, { projectId: asProjectId("prj_repo"), removed: true }).data.removed).toBe(true);
  });
});
