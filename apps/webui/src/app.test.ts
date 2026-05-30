import { describe, expect, it } from "vitest";

import { renderWebUiShell, webUiStyles } from "./shell.js";

describe("S0031 WebUI shell", () => {
  it("renders a remote-first project/session chatbox", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-region="sidebar"');
    expect(html).toContain('data-remote-list');
    expect(html).toContain('data-remote-settings-form');
    expect(html).toContain("Projects");
    expect(html).toContain('data-project-list');
    expect(html).toContain('data-session-list');
    expect(html).toContain('data-region="session-stream"');
    expect(html).toContain('data-event-stream');
    expect(html).toContain("Choose a project session to start chatting.");
    expect(html).toContain('data-region="composer"');
    expect(html).toContain("Ask Scorel to continue this session");
    expect(html).toContain("Tools");
    expect(html).toContain('data-prompt-input');
    expect(html).toContain('data-send-button');
    expect(html).toContain('data-cancel-button');
    expect(html).toContain('data-composer-status');
    expect(html).toContain("Send");
  });

  it("keeps remote connection controls in a settings panel", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-remote-settings-form');
    expect(html).toContain("Remote settings");
    expect(html).toContain("Display name");
    expect(html).toContain("Endpoint");
    expect(html).toContain("Token");
    expect(html).toContain('data-status data-state="idle"');
  });

  it("renders remote identity, resync, anchor, and persisted connection regions", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-identity');
    expect(html).toContain('data-resync-mode');
    expect(html).toContain('data-persistent-seq');
    expect(html).toContain('data-stream-seq');
    expect(html).toContain("Save and connect");
  });

  it("renders session browser and tree regions", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-project-list');
    expect(html).toContain('data-session-list');
    expect(html).toContain('data-session-tree');
    expect(html).toContain("No remote connected");
    expect(html).toContain("Session tree");
  });

  it("does not ship fake project or session rows", () => {
    const html = renderWebUiShell();

    expect(html).not.toContain("<span>Default</span>");
    expect(html).not.toContain("<span>Unsorted</span>");
    expect(html).not.toContain("S0031 WebUI information architecture");
    expect(html).not.toContain("S0030 WebUI baseline");
  });

  it("ships the shell styling with responsive layout rules", () => {
    expect(webUiStyles).toContain(".scorel-webui-shell");
    expect(webUiStyles).toContain(".webui-sidebar");
    expect(webUiStyles).toContain(".composer-panel");
    expect(webUiStyles).toContain("@media (max-width: 860px)");
  });
});
