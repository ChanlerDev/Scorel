export const webUiStyles = `
  :root {
    color: #24272c;
    background: #e7e5df;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background: #e7e5df;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  .scorel-webui-shell {
    display: grid;
    grid-template-columns: 330px minmax(0, 1fr);
    min-height: 100vh;
    color: #2b2f35;
  }

  .webui-sidebar {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
    min-height: 100vh;
    padding: 22px 10px 14px;
    border-right: 1px solid rgba(52, 55, 59, 0.12);
    background: linear-gradient(120deg, #e2e2df 0%, #e6e1df 52%, #eee4e1 100%);
  }

  .window-controls {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 0 16px;
    color: #8b8b88;
    font-size: 24px;
  }

  .traffic-lights {
    display: flex;
    gap: 18px;
    margin-right: 6px;
  }

  .traffic-lights span {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(0, 0, 0, 0.16);
    border-radius: 999px;
  }

  .traffic-lights span:nth-child(1) {
    background: #ff5f57;
  }

  .traffic-lights span:nth-child(2) {
    background: #ffbd2e;
  }

  .traffic-lights span:nth-child(3) {
    background: #28c840;
  }

  .sidebar-actions,
  .device-tree,
  .project-branch,
  .session-branch {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .sidebar-actions {
    gap: 10px;
    padding: 0 8px;
  }

  .action-row,
  .tree-row,
  .settings-entry {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 36px;
    border: 0;
    border-radius: 14px;
    background: transparent;
    color: #4f5358;
    padding: 6px 10px;
    text-align: left;
  }

  .action-row {
    color: #3f4348;
    font-size: 16px;
    font-weight: 650;
  }

  .action-row.is-muted {
    color: #969693;
  }

  .action-icon,
  .tree-icon,
  .settings-icon {
    display: grid;
    place-items: center;
    width: 24px;
    color: #5f6368;
    font-size: 18px;
  }

  .section-label {
    margin: 10px 16px 8px;
    color: #969693;
    font-size: 15px;
    font-weight: 780;
  }

  .device-tree {
    gap: 2px;
    padding: 0 0 0 8px;
  }

  .project-branch,
  .session-branch {
    gap: 2px;
    margin: 2px 0 2px 24px;
  }

  .device-row {
    color: #62666b;
    font-size: 16px;
    font-weight: 650;
  }

  .project-row,
  .session-row {
    min-height: 34px;
    color: #53575d;
    font-size: 15px;
  }

  .session-row.is-active,
  .session-row:hover,
  .project-row.is-active,
  .settings-entry:hover {
    background: rgba(198, 198, 194, 0.68);
    color: #23262b;
  }

  .session-row.is-active {
    font-weight: 760;
  }

  .tree-count {
    min-width: 30px;
    border-radius: 999px;
    background: rgba(206, 201, 199, 0.62);
    color: #707073;
    padding: 2px 7px;
    font-size: 12px;
    font-weight: 760;
    text-align: center;
  }

  .tree-empty {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: 36px;
    color: #8b8b88;
    padding: 6px 10px;
  }

  .tree-empty-nested {
    min-height: 30px;
    font-size: 13px;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 0 8px;
  }

  .settings-entry {
    color: #24272c;
    font-size: 16px;
    font-weight: 760;
  }

  .webui-main {
    display: none;
    grid-template-rows: minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 100vh;
    background: #fbfaf7;
  }

  .webui-main.is-visible {
    display: grid;
  }

  .session-stream {
    min-width: 0;
    overflow: auto;
    padding: 48px 22px 20px;
  }

  .stream-column {
    width: min(840px, 100%);
    margin: 0 auto;
  }

  .hero-empty {
    margin: 88px auto 36px;
    text-align: center;
  }

  .scorel-mark {
    display: inline-grid;
    place-items: center;
    width: 58px;
    height: 58px;
    border-radius: 20px;
    background: #25282d;
    color: #fff;
    font-size: 22px;
    font-weight: 850;
  }

  .hero-empty h2 {
    margin: 20px 0 8px;
    font-size: clamp(30px, 5vw, 44px);
    line-height: 1.05;
    letter-spacing: -0.045em;
  }

  .hero-empty p {
    margin: 0;
    color: #776f65;
    font-size: 14px;
  }

  .event-card,
  .session-tree-card {
    padding: 16px 18px;
    border-radius: 22px;
    background: transparent;
  }

  .event-card + .event-card {
    margin-top: 10px;
  }

  .event-card-user {
    width: fit-content;
    max-width: min(680px, 86%);
    margin-left: auto;
    background: #25282d;
    color: #fff;
  }

  .event-card-assistant,
  .event-card-tool,
  .event-card-status,
  .event-card-error {
    max-width: min(700px, 90%);
    background: #f0ebe2;
  }

  .event-card-error {
    background: #fff0ef;
  }

  .event-kicker {
    margin: 0 0 7px;
    color: inherit;
    opacity: 0.62;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .event-card h3 {
    margin: 0 0 6px;
    font-size: 15px;
  }

  .event-card p {
    margin: 0;
    line-height: 1.55;
  }

  .session-tree-card {
    margin-top: 12px;
    border: 1px solid #ece7df;
    background: #fffdf8;
  }

  .session-tree-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .session-tree-node {
    display: grid;
    gap: 4px;
    margin-left: calc(var(--depth, 0) * 16px);
    padding: 9px 10px;
    border-radius: 12px;
    background: #f7f2ea;
  }

  .tree-node-title {
    color: #71695f;
    font-size: 12px;
    font-weight: 800;
  }

  .tree-node-text {
    color: #25282d;
    font-size: 13px;
  }

  .tree-node-badge {
    width: fit-content;
    color: #71695f;
    font-size: 11px;
    font-weight: 800;
  }

  .composer-wrap {
    padding: 0 22px 24px;
  }

  .composer-panel {
    width: min(840px, 100%);
    margin: 0 auto;
    padding: 10px;
    border: 1px solid #ded8cc;
    border-radius: 26px;
    background: #fffdf8;
    box-shadow: 0 18px 50px rgba(56, 48, 39, 0.09);
  }

  .composer-input {
    width: 100%;
    min-height: 74px;
    resize: vertical;
    border: 0;
    border-radius: 18px;
    background: #f7f2ea;
    color: #25282d;
    outline: none;
    padding: 14px;
  }

  .device-settings input:focus,
  .composer-input:focus {
    border-color: #9f9588;
    box-shadow: 0 0 0 3px rgba(82, 73, 63, 0.1);
  }

  .composer-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .tool-chip,
  .send-button,
  .connect-button {
    height: 34px;
    border: 1px solid #ded8cc;
    border-radius: 999px;
    background: transparent;
    color: #62594f;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 700;
  }

  .send-button,
  .connect-button {
    border-color: #25282d;
    background: #25282d;
    color: #fff;
  }

  .send-button {
    margin-left: auto;
  }

  .tool-chip:disabled,
  .send-button:disabled,
  .composer-input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .composer-status {
    margin: 8px 3px 0;
    color: #7b7369;
    font-size: 12px;
  }

  .settings-page {
    display: none;
    min-width: 0;
    min-height: 100vh;
    background: #fbfaf7;
    padding: 56px 36px;
  }

  .settings-page.is-visible {
    display: block;
  }

  .settings-panel {
    width: min(620px, 100%);
    margin: 0 auto;
  }

  .settings-panel h1 {
    margin: 0;
    font-size: 34px;
    letter-spacing: -0.04em;
  }

  .settings-panel p {
    margin: 8px 0 24px;
    color: #7a7268;
  }

  .device-settings {
    display: grid;
    gap: 14px;
    padding: 18px;
    border: 1px solid #e4ded3;
    border-radius: 24px;
    background: #fffdf8;
  }

  .device-settings label {
    display: grid;
    gap: 7px;
    color: #6f675d;
    font-size: 13px;
    font-weight: 700;
  }

  .device-settings input {
    width: 100%;
    height: 42px;
    border: 1px solid #dfd8ce;
    border-radius: 14px;
    background: #fbfaf7;
    color: #25282d;
    outline: none;
    padding: 0 12px;
  }

  .connection-status {
    margin: 6px 0 0;
    color: #7c746a;
    font-size: 13px;
  }

  .sync-facts {
    display: grid;
    gap: 6px;
    margin-top: 8px;
    color: #81786e;
    font-size: 12px;
  }

  .sync-facts div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .sync-facts span:last-child {
    color: #34302b;
    font-weight: 700;
    text-align: right;
  }

  @media (max-width: 860px) {
    .scorel-webui-shell {
      grid-template-columns: 1fr;
    }

    .webui-sidebar {
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid rgba(52, 55, 59, 0.12);
    }
  }
`;

export const renderWebUiShell = (): string => `
  <style data-scorel-webui-styles>${webUiStyles}</style>
  <main class="scorel-webui-shell">
    <aside class="webui-sidebar" data-region="sidebar" aria-label="Devices, projects, and sessions">
      <div class="window-controls" aria-label="Window controls">
        <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
        <span aria-hidden="true">▯</span>
        <span aria-hidden="true">←</span>
        <span aria-hidden="true">→</span>
      </div>

      <nav aria-label="Primary">
        <ul class="sidebar-actions">
          <li><button class="action-row" type="button"><span class="action-icon">✎</span><span>New Chat</span></button></li>
          <li><button class="action-row" type="button"><span class="action-icon">⌕</span><span>Search</span></button></li>
          <li><button class="action-row" type="button"><span class="action-icon">▧</span><span>Skills</span></button></li>
          <li><button class="action-row is-muted" type="button"><span class="action-icon">⌘</span><span>Plugins</span></button></li>
          <li><button class="action-row" type="button"><span class="action-icon">◷</span><span>Automations</span></button></li>
        </ul>
      </nav>

      <nav aria-label="Projects">
        <p class="section-label">Projects</p>
        <ul class="device-tree" data-device-tree>
          <li class="tree-empty"><span class="tree-icon">-</span><span>No devices configured</span></li>
        </ul>
      </nav>

      <div class="sidebar-footer">
        <button class="settings-entry" type="button" data-settings-button>
          <span class="settings-icon">⚙</span>
          <span>Settings</span>
        </button>
      </div>
    </aside>

    <section class="webui-main" data-page="chat" aria-label="Chatbox">
      <section class="session-stream" data-region="session-stream" aria-label="Chat transcript">
        <div class="stream-column">
          <div class="hero-empty">
            <div class="scorel-mark" aria-hidden="true">S</div>
            <h2 data-chat-title>Choose a project session to start chatting.</h2>
            <p>Open Settings to add a device, then choose a session from the sidebar.</p>
          </div>

          <div data-event-stream></div>
          <div data-session-tree>
            <article class="session-tree-card">
              <p class="event-kicker">Session tree</p>
              <p>Select a session to inspect its persistent event tree.</p>
            </article>
          </div>
        </div>
      </section>

      <footer class="composer-wrap" data-region="composer" aria-label="Prompt composer">
        <form class="composer-panel" data-composer-form>
          <textarea class="composer-input" data-prompt-input placeholder="Ask Scorel to continue this session" disabled></textarea>
          <div class="composer-toolbar">
            <button class="tool-chip" type="button" disabled>Tools</button>
            <button class="tool-chip" type="button" disabled>Model</button>
            <button class="tool-chip" data-cancel-button type="button" disabled>Cancel</button>
            <button class="send-button" data-send-button type="submit" disabled>Send</button>
          </div>
          <p class="composer-status" data-composer-status>Choose a session before sending prompts</p>
        </form>
      </footer>
    </section>

    <section class="settings-page is-visible" data-page="settings" aria-label="Settings">
      <div class="settings-panel">
        <h1>Device settings</h1>
        <p>Add a remote device. Scorel will sync its projects first, then sessions under each project.</p>
        <form class="device-settings" data-device-settings-form>
          <label>
            Name
            <input name="name" autocomplete="off" placeholder="Tokyo workstation" />
          </label>
          <label>
            Link
            <input name="endpoint" autocomplete="off" placeholder="ws://127.0.0.1:18789" required />
          </label>
          <label>
            Token
            <input name="token" autocomplete="off" type="password" required />
          </label>
          <button class="connect-button" type="submit">Save device</button>
          <p class="connection-status" data-status data-state="idle">Disconnected</p>
          <div class="sync-facts" aria-label="Device sync details">
            <div><span>Device</span><span data-identity>Not connected</span></div>
            <div><span>Resync</span><span data-resync-mode>-</span></div>
            <div><span>Persistent</span><span data-persistent-seq>-</span></div>
            <div><span>Stream</span><span data-stream-seq>-</span></div>
          </div>
        </form>
      </div>
    </section>
  </main>
`;
