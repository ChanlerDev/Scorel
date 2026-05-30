import { describe, expect, it } from "vitest";

import { renderWebUiShell, webUiStyles } from "./shell.js";

describe("S0031 WebUI shell", () => {
  it("renders a device-first project/session chatbox", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-region="sidebar"');
    expect(html).toContain('data-device-tree');
    expect(html).toContain("Projects");
    expect(html).toContain("New Chat");
    expect(html).toContain("Search");
    expect(html).toContain("Skills");
    expect(html).toContain("Plugins");
    expect(html).toContain("Automations");
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

  it("keeps device connection controls in a dedicated settings page", () => {
    const html = renderWebUiShell();
    const sidebar = html.slice(html.indexOf('data-region="sidebar"'), html.indexOf('data-region="session-stream"'));

    expect(html).toContain('class="settings-page is-visible" data-page="settings"');
    expect(html).toContain('class="webui-main" data-page="chat"');
    expect(html).toContain('data-device-settings-form');
    expect(html).toContain("Device settings");
    expect(html).toContain("Name");
    expect(html).toContain("Link");
    expect(html).toContain("Token");
    expect(html).toContain('data-status data-state="idle"');
    expect(sidebar).not.toContain('name="endpoint"');
    expect(sidebar).not.toContain('name="token"');
  });

  it("renders device identity, resync, anchor, and persisted connection regions", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-identity');
    expect(html).toContain('data-resync-mode');
    expect(html).toContain('data-persistent-seq');
    expect(html).toContain('data-stream-seq');
    expect(html).toContain("Save device");
  });

  it("renders session browser and tree regions", () => {
    const html = renderWebUiShell();

    expect(html).toContain('data-device-tree');
    expect(html).toContain('data-session-tree');
    expect(html).toContain("No devices configured");
    expect(html).toContain("Session tree");
  });

  it("does not ship fake project or session rows", () => {
    const html = renderWebUiShell();

    expect(html).not.toContain("<span>Default</span>");
    expect(html).not.toContain("<span>Unsorted</span>");
    expect(html).not.toContain("S0031 WebUI information architecture");
    expect(html).not.toContain("S0030 WebUI baseline");
  });

  it("does not ship a separate remote rail or inline remote settings", () => {
    const html = renderWebUiShell();

    expect(html).not.toContain("remote-rail");
    expect(html).not.toContain('data-remote-list');
    expect(html).not.toContain('data-remote-settings-form');
    expect(html).not.toContain("Remote settings");
  });

  it("ships the shell styling with responsive layout rules", () => {
    expect(webUiStyles).toContain(".scorel-webui-shell");
    expect(webUiStyles).toContain(".webui-sidebar");
    expect(webUiStyles).toContain(".composer-panel");
    expect(webUiStyles).toContain(".settings-page");
    expect(webUiStyles).toContain("@media (max-width: 860px)");
  });
});
