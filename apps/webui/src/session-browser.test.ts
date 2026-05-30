import { describe, expect, it } from "vitest";

import { asClientId, asEventId, asSeq, asSessionId, type PersistentEvent } from "@scorel/protocol";

import { createSessionBrowser, projectSessionTree, renderDeviceTree, renderSessionBrowser } from "./session-browser.js";

const sessionId = asSessionId("ses_tree");
const clientId = asClientId("client_tree");

const userEvent: PersistentEvent = {
  type: "user_message",
  id: asEventId("evt_user"),
  parentId: null,
  seq: asSeq(1),
  sessionId,
  clientId,
  ts: 1,
  message: { role: "user", content: [{ type: "text", text: "Build the web UI" }] },
};

const assistantEvent: PersistentEvent = {
  type: "assistant_message",
  id: asEventId("evt_assistant"),
  parentId: asEventId("evt_user"),
  seq: asSeq(2),
  sessionId,
  clientId,
  ts: 2,
  message: { role: "assistant", content: [{ type: "text", text: "Implemented session browser" }] },
};

describe("S0034 session browser", () => {
  it("projects persistent events into a read-only tree with the active leaf marked", () => {
    expect(projectSessionTree([userEvent, assistantEvent], asEventId("evt_assistant"))).toEqual([
      {
        id: "evt_user",
        parentId: null,
        depth: 0,
        kind: "user",
        title: "User",
        text: "Build the web UI",
        seq: asSeq(1),
        isActiveLeaf: false,
      },
      {
        id: "evt_assistant",
        parentId: "evt_user",
        depth: 1,
        kind: "assistant",
        title: "Assistant",
        text: "Implemented session browser",
        seq: asSeq(2),
        isActiveLeaf: true,
      },
    ]);
  });

  it("refreshes session summaries and loads the selected session", async () => {
    const browser = createSessionBrowser({
      client: {
        listSessions: async () => [
          {
            sessionId,
            title: "S0034 WebUI session browser",
            model: "test-model",
            updatedAt: 20,
            currentSeq: asSeq(2),
          },
        ],
        loadSession: async (requestedSessionId) => ({
          sessionId: requestedSessionId,
          activeLeafId: asEventId("evt_assistant"),
          currentSeq: asSeq(2),
          events: [userEvent, assistantEvent],
          meta: { title: "S0034 WebUI session browser", model: "test-model" },
        }),
      },
      projectSlug: "scorel",
    });

    const refreshed = await browser.refresh();
    expect(refreshed.projectSlug).toBe("scorel");
    expect(refreshed.sessions).toHaveLength(1);

    const loaded = await browser.load(sessionId);
    expect(loaded.selectedSessionId).toBe(sessionId);
    expect(loaded.tree.map((node) => [node.id, node.isActiveLeaf])).toEqual([
      ["evt_user", false],
      ["evt_assistant", true],
    ]);
  });

  it("renders escaped sessions and tree nodes", () => {
    const html = renderSessionBrowser({
      projectSlug: "scorel",
      projects: [],
      selectedProjectKey: null,
      sessions: [
        {
          sessionId,
          title: "<script>alert(1)</script>",
          model: "test-model",
          updatedAt: 20,
          currentSeq: asSeq(2),
        },
      ],
      selectedSessionId: sessionId,
      tree: projectSessionTree([userEvent, assistantEvent], asEventId("evt_assistant")),
    });

    expect(html.sessions).toContain("data-session-id=\"ses_tree\"");
    expect(html.sessions).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.tree).toContain("data-tree-node-id=\"evt_assistant\"");
    expect(html.tree).toContain("active leaf");
    expect(html.tree).not.toContain("<script>");
  });

  it("renders a device -> project -> session hierarchy", () => {
    const html = renderDeviceTree({
      devices: [
        {
          id: "device_tokyo",
          name: "Tokyo <device>",
          projects: [
            {
              projectKey: "remote:device_tokyo:scorel",
              displayName: "Scorel",
              remoteLabel: "Tokyo",
              sessions: [
                {
                  sessionId,
                  title: "Fix <WebUI>",
                  model: "test-model",
                  updatedAt: 20,
                  currentSeq: asSeq(2),
                },
              ],
            },
          ],
        },
      ],
      selectedProjectKey: "remote:device_tokyo:scorel",
      selectedSessionId: sessionId,
    });

    expect(html).toContain('data-device-id="device_tokyo"');
    expect(html).toContain("Tokyo &lt;device&gt;");
    expect(html).toContain('data-project-key="remote:device_tokyo:scorel"');
    expect(html).toContain("Scorel");
    expect(html).toContain('data-session-id="ses_tree"');
    expect(html).toContain("Fix &lt;WebUI&gt;");
    expect(html).not.toContain("<device>");
    expect(html).not.toContain("<WebUI>");
  });

  it("keeps connected devices useful when a project has no sessions yet", () => {
    const html = renderDeviceTree({
      devices: [
        {
          id: "device_remote",
          name: "Remote daemon",
          projects: [
            {
              projectKey: "remote:device_remote:scorel",
              displayName: "scorel",
              remoteLabel: "Remote daemon",
              sessions: [],
            },
          ],
        },
      ],
      selectedProjectKey: "remote:device_remote:scorel",
      selectedSessionId: null,
    });

    expect(html).toContain('data-device-id="device_remote"');
    expect(html).toContain('data-project-key="remote:device_remote:scorel"');
    expect(html).toContain("No sessions synced");
  });
});
