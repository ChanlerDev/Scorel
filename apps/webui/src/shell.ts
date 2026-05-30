export const webUiStyles = `
  :root {
    color: #1f2328;
    background: #f4f1eb;
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
    background: #f4f1eb;
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
    grid-template-columns: 76px 318px minmax(0, 1fr);
    min-height: 100vh;
    color: #23262b;
  }

  .remote-rail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 10px;
    border-right: 1px solid #ded8cc;
    background: #e9e2d7;
  }

  .brand-mark,
  .remote-pill {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid #d7d0c4;
    border-radius: 16px;
    background: #faf8f3;
    color: #25282d;
    font-weight: 760;
  }

  .remote-pill {
    border: 0;
    background: transparent;
    color: #6d665d;
  }

  .remote-pill.is-active {
    background: #25282d;
    color: #fff;
  }

  .remote-add {
    margin-top: auto;
    width: 44px;
    height: 44px;
    border: 1px dashed #bfb6aa;
    border-radius: 16px;
    background: transparent;
    color: #6d665d;
    font-size: 22px;
  }

  .webui-sidebar {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
    min-height: 100vh;
    padding: 18px 16px;
    border-right: 1px solid #e2ddd3;
    background: #f8f5ef;
  }

  .sidebar-header h1 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.02em;
  }

  .sidebar-header p {
    margin: 4px 0 0;
    color: #7c746a;
    font-size: 12px;
  }

  .remote-settings {
    padding: 12px;
    border: 1px solid #e3ded5;
    border-radius: 18px;
    background: #fffdf8;
  }

  .remote-settings h2 {
    margin: 0 0 10px;
    font-size: 13px;
  }

  .remote-settings label {
    display: grid;
    gap: 5px;
    margin-top: 8px;
    color: #71695f;
    font-size: 12px;
  }

  .remote-settings input {
    width: 100%;
    height: 34px;
    border: 1px solid #dfd8ce;
    border-radius: 12px;
    background: #fbfaf7;
    color: #25282d;
    outline: none;
    padding: 0 10px;
  }

  .remote-settings input:focus,
  .composer-input:focus {
    border-color: #9f9588;
    box-shadow: 0 0 0 3px rgba(82, 73, 63, 0.1);
  }

  .connect-button,
  .send-button {
    border: 0;
    border-radius: 999px;
    background: #25282d;
    color: #fff;
    font-weight: 700;
  }

  .connect-button {
    width: 100%;
    height: 36px;
    margin-top: 10px;
  }

  .connection-status {
    margin: 10px 0 0;
    color: #7c746a;
    font-size: 12px;
  }

  .sync-facts {
    display: grid;
    gap: 5px;
    margin-top: 10px;
    color: #81786e;
    font-size: 11px;
  }

  .sync-facts div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .sync-facts span:last-child {
    color: #34302b;
    font-weight: 700;
    text-align: right;
  }

  .section-label {
    margin: 0 0 8px;
    color: #92887d;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .project-list,
  .session-list,
  .remote-list,
  .session-tree-list {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .nav-row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    border: 0;
    border-radius: 13px;
    background: transparent;
    color: #514b44;
    padding: 7px 8px;
    text-align: left;
  }

  .nav-row.is-active,
  .nav-row:hover {
    background: #ebe4d9;
    color: #24262b;
  }

  .nav-row-empty {
    color: #92887d;
  }

  .glyph {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 9px;
    background: #fffdf8;
    color: #766d63;
    font-size: 12px;
    font-weight: 800;
  }

  .badge {
    padding: 2px 7px;
    border-radius: 999px;
    background: #fffdf8;
    color: #857b70;
    font-size: 11px;
    font-weight: 800;
  }

  .webui-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 100vh;
    background: #fbfaf7;
  }

  .main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 58px;
    padding: 0 28px;
    border-bottom: 1px solid #ece7df;
  }

  .main-header h2 {
    margin: 0;
    font-size: 15px;
  }

  .header-meta {
    color: #857d73;
    font-size: 12px;
  }

  .session-stream {
    min-width: 0;
    overflow: auto;
    padding: 36px 22px 20px;
  }

  .stream-column {
    width: min(820px, 100%);
    margin: 0 auto;
  }

  .hero-empty {
    margin: 80px auto 36px;
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
    width: min(820px, 100%);
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

  .composer-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .tool-chip,
  .send-button {
    height: 34px;
    border: 1px solid #ded8cc;
    border-radius: 999px;
    background: transparent;
    color: #62594f;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 700;
  }

  .send-button {
    margin-left: auto;
    border-color: #25282d;
    background: #25282d;
    color: #fff;
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

  @media (max-width: 860px) {
    .scorel-webui-shell {
      grid-template-columns: 1fr;
    }

    .remote-rail {
      flex-direction: row;
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid #ded8cc;
    }

    .webui-sidebar {
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid #e2ddd3;
    }
  }
`;

export const renderWebUiShell = (): string => `
  <style data-scorel-webui-styles>${webUiStyles}</style>
  <main class="scorel-webui-shell">
    <aside class="remote-rail" aria-label="Saved remotes">
      <div class="brand-mark" aria-hidden="true">S</div>
      <nav aria-label="Remotes">
        <ul class="remote-list" data-remote-list>
          <li><button class="remote-pill is-active" type="button" title="Remote settings">R</button></li>
        </ul>
      </nav>
      <button class="remote-add" type="button" aria-label="Add remote">+</button>
    </aside>

    <aside class="webui-sidebar" data-region="sidebar" aria-label="Remote projects and sessions">
      <div class="sidebar-header">
        <h1>Scorel</h1>
        <p>Remote projects and sessions</p>
      </div>

      <section class="remote-settings" aria-label="Remote settings">
        <h2>Remote settings</h2>
        <form data-remote-settings-form>
          <label>
            Display name
            <input name="name" autocomplete="off" placeholder="Tokyo workstation" />
          </label>
          <label>
            Endpoint
            <input name="endpoint" autocomplete="off" placeholder="ws://127.0.0.1:18789" required />
          </label>
          <label>
            Token
            <input name="token" autocomplete="off" type="password" required />
          </label>
          <button class="connect-button" type="submit">Save and connect</button>
        </form>
        <p class="connection-status" data-status data-state="idle">Disconnected</p>
        <div class="sync-facts" aria-label="Remote sync details">
          <div><span>Remote</span><span data-identity>Not connected</span></div>
          <div><span>Resync</span><span data-resync-mode>-</span></div>
          <div><span>Persistent</span><span data-persistent-seq>-</span></div>
          <div><span>Stream</span><span data-stream-seq>-</span></div>
        </div>
      </section>

      <nav aria-label="Projects">
        <p class="section-label">Projects</p>
        <ul class="project-list" data-project-list>
          <li class="nav-row nav-row-empty"><span class="glyph">-</span><span>No remote connected</span><span class="badge">0</span></li>
        </ul>
      </nav>

      <nav aria-label="Sessions">
        <p class="section-label">Sessions</p>
        <ul class="session-list" data-session-list>
          <li class="nav-row nav-row-empty"><span class="glyph">-</span><span>No sessions synced</span><span class="badge">0</span></li>
        </ul>
      </nav>
    </aside>

    <section class="webui-main" aria-label="Chatbox">
      <header class="main-header">
        <h2 data-chat-title>Choose a session</h2>
        <div class="header-meta">Remote-only WebUI · Project → Session</div>
      </header>

      <section class="session-stream" data-region="session-stream" aria-label="Chat transcript">
        <div class="stream-column">
          <div class="hero-empty">
            <div class="scorel-mark" aria-hidden="true">S</div>
            <h2>Choose a project session to start chatting.</h2>
            <p>Save a remote, sync its projects, then open a session.</p>
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
          <p class="composer-status" data-composer-status>Connect before sending prompts</p>
        </form>
      </footer>
    </section>
  </main>
`;
