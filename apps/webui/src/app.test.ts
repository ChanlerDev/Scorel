import { describe, expect, it } from "vitest";

import { renderWebUiShell, webUiStyles } from "./shell.js";

describe("S0031 WebUI shell", () => {
  it("renders the project/session sidebar, session surface, and composer", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-region="sidebar"');
    expect(html).toContain("Projects");
    expect(html).toContain("Scorel");
    expect(html).toContain("No sessions loaded");
    expect(html).toContain('data-region="session-stream"');
    expect(html).toContain('data-event-stream');
    expect(html).toContain("Session stream");
    expect(html).toContain("Connect to a remote daemon to watch the shared session.");
    expect(html).toContain('data-region="composer"');
    expect(html).toContain("Ask Scorel to continue this session");
    expect(html).toContain("Tools");
    expect(html).toContain("Send");
  });

  it("keeps remote connection controls inside the sidebar", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-connect-form');
    expect(html).toContain("Remote daemon");
    expect(html).toContain("WebSocket endpoint");
    expect(html).toContain("Token");
    expect(html).toContain("Session id");
    expect(html).toContain('data-status data-state="idle"');
  });

  it("renders remote identity, resync, anchor, and reconnect regions", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-identity');
    expect(html).toContain('data-resync-mode');
    expect(html).toContain('data-persistent-seq');
    expect(html).toContain('data-stream-seq');
    expect(html).toContain('data-reconnect-button');
  });

  it("renders session browser and tree regions", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-session-list');
    expect(html).toContain('data-session-tree');
    expect(html).toContain("No sessions loaded");
    expect(html).toContain("Session tree");
  });

  it("ships the shell styling with responsive layout rules", () => {
    expect(webUiStyles).toContain(".scorel-webui-shell");
    expect(webUiStyles).toContain(".webui-sidebar");
    expect(webUiStyles).toContain(".composer-panel");
    expect(webUiStyles).toContain("@media (max-width: 760px)");
  });
});
