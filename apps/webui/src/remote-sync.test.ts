import { describe, expect, it } from "vitest";

import { asDeviceId, asSeq, asSessionId } from "@scorel/protocol";

import { createRemoteSyncIndex } from "./remote-sync.js";

describe("remote project/session synchronization", () => {
  it("projects daemon identity and session summaries into project-first index", () => {
    const index = createRemoteSyncIndex({
      remoteId: "remote_tokyo",
      identity: {
        deviceId: asDeviceId("device_tokyo"),
        deviceDisplayName: "Tokyo Workstation",
        projectSlug: "scorel",
      },
      sessions: [
        {
          sessionId: asSessionId("ses_alpha"),
          title: "Fix WebUI",
          model: "deepseek-v4-flash",
          updatedAt: 20,
          currentSeq: asSeq(7),
        },
      ],
    });

    expect(index.projects).toEqual([
      {
        projectKey: "remote:device_tokyo:scorel",
        displayName: "scorel",
        remoteLabel: "Tokyo Workstation",
        sessions: [
          {
            sessionId: asSessionId("ses_alpha"),
            title: "Fix WebUI",
            model: "deepseek-v4-flash",
            updatedAt: 20,
            currentSeq: asSeq(7),
          },
        ],
      },
    ]);
  });
});
