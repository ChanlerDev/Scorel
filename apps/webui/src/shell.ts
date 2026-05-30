export const webUiStyles = `
  :root {
    color: #202124;
    background: #f6f7f9;
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
    background: #f7f8fa;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  .scorel-webui-shell {
    display: grid;
    grid-template-columns: 292px minmax(0, 1fr);
    min-height: 100vh;
    color: #24262b;
  }

  .webui-sidebar {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 100vh;
    padding: 18px 14px;
    background: #eef0f3;
    border-right: 1px solid #dfe2e7;
  }

  .sidebar-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
  }

  .traffic-lights {
    display: flex;
    gap: 8px;
  }

  .traffic-lights span {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: #d7dce2;
  }

  .traffic-lights span:nth-child(1) {
    background: #f06d63;
  }

  .traffic-lights span:nth-child(2) {
    background: #f4c04f;
  }

  .traffic-lights span:nth-child(3) {
    background: #65c76f;
  }

  .sidebar-actions {
    display: flex;
    gap: 6px;
    color: #707780;
    font-size: 13px;
  }

  .section-label {
    margin: 0 0 10px;
    color: #8a93a0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .project-list,
  .session-list {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .nav-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 6px 8px;
    border-radius: 12px;
    color: #4b515a;
    font-size: 14px;
  }

  .nav-row.is-active {
    background: #dde1e6;
    color: #20242a;
    font-weight: 650;
  }

  .nav-row .badge {
    min-width: 24px;
    padding: 2px 7px;
    border-radius: 999px;
    background: #f6f7f9;
    color: #8a93a0;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
  }

  .glyph {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 8px;
    background: #f7f8fa;
    color: #78828e;
    font-size: 12px;
    font-weight: 700;
  }

  .connection-card {
    margin-top: auto;
    padding: 12px;
    border: 1px solid #dfe3e8;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.72);
  }

  .connection-card h2 {
    margin: 0 0 4px;
    font-size: 14px;
  }

  .connection-card p {
    margin: 0 0 12px;
    color: #7b838d;
    font-size: 12px;
    line-height: 1.4;
  }

  .connection-card label {
    display: grid;
    gap: 5px;
    margin-top: 8px;
    color: #68717d;
    font-size: 12px;
  }

  .connection-card input,
  .composer-input {
    width: 100%;
    border: 1px solid #dfe3e8;
    border-radius: 12px;
    background: #fff;
    color: #25282d;
    outline: none;
  }

  .connection-card input {
    height: 34px;
    padding: 0 10px;
  }

  .connection-card input:focus,
  .composer-input:focus {
    border-color: #aeb7c2;
    box-shadow: 0 0 0 3px rgba(80, 91, 107, 0.08);
  }

  .connect-button {
    width: 100%;
    height: 36px;
    margin-top: 10px;
    border: 0;
    border-radius: 12px;
    background: #25282d;
    color: #fff;
    font-weight: 650;
  }

  .connection-status {
    margin: 10px 0 0;
    color: #7b838d;
    font-size: 12px;
  }

  .connection-facts {
    display: grid;
    gap: 6px;
    margin-top: 10px;
    color: #69727e;
    font-size: 11px;
  }

  .connection-facts div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .connection-facts span:last-child {
    color: #25282d;
    font-weight: 650;
    text-align: right;
  }

  .reconnect-button {
    width: 100%;
    height: 32px;
    margin-top: 10px;
    border: 1px solid #dfe3e8;
    border-radius: 12px;
    background: #fff;
    color: #5d6673;
    font-weight: 650;
  }

  .webui-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 100vh;
    background: #fbfbfc;
  }

  .main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 60px;
    padding: 0 28px;
    border-bottom: 1px solid #eceef1;
    background: rgba(255, 255, 255, 0.86);
  }

  .main-header h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 720;
    letter-spacing: -0.01em;
  }

  .header-meta {
    color: #858c95;
    font-size: 13px;
  }

  .session-stream {
    display: flex;
    justify-content: center;
    min-width: 0;
    overflow: auto;
    padding: 46px 24px 26px;
  }

  .stream-column {
    width: min(860px, 100%);
  }

  .hero-empty {
    margin: 26px auto 34px;
    text-align: center;
  }

  .scorel-mark {
    display: inline-grid;
    place-items: center;
    width: 66px;
    height: 66px;
    border: 1px solid #e5e7eb;
    border-radius: 22px;
    background: #fff;
    color: #20242a;
    font-size: 24px;
    font-weight: 800;
    box-shadow: 0 14px 40px rgba(33, 37, 43, 0.08);
  }

  .hero-empty h2 {
    margin: 22px 0 8px;
    font-size: clamp(28px, 5vw, 42px);
    line-height: 1.05;
    letter-spacing: -0.045em;
  }

  .hero-empty p {
    margin: 0;
    color: #738096;
    font-size: 14px;
  }

  .event-card {
    padding: 18px 20px;
    border: 1px solid #eceef1;
    border-radius: 22px;
    background: #fff;
    box-shadow: 0 16px 50px rgba(33, 37, 43, 0.05);
  }

  .event-card + .event-card {
    margin-top: 14px;
  }

  .event-card-user {
    border-color: #dce6f5;
    background: #fbfdff;
  }

  .event-card-assistant {
    border-color: #eceef1;
  }

  .event-card-tool {
    border-color: #e5e8df;
    background: #fcfdf9;
  }

  .event-card-status,
  .event-card-error {
    box-shadow: none;
  }

  .event-card-error {
    border-color: #f1d6d6;
    background: #fffafa;
  }

  .event-kicker {
    margin: 0 0 8px;
    color: #8b94a2;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .event-card h3 {
    margin: 0 0 8px;
    font-size: 17px;
  }

  .event-card p {
    margin: 0;
    color: #5d6673;
    line-height: 1.55;
  }

  .composer-wrap {
    display: flex;
    justify-content: center;
    padding: 0 24px 26px;
  }

  .composer-panel {
    width: min(860px, 100%);
    padding: 12px;
    border: 1px solid #e1e4e8;
    border-radius: 24px;
    background: #fff;
    box-shadow: 0 18px 60px rgba(32, 36, 42, 0.08);
  }

  .composer-input {
    min-height: 72px;
    resize: vertical;
    padding: 13px 14px;
    border: 0;
    background: #f8f9fb;
  }

  .composer-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .tool-chip,
  .send-button {
    height: 32px;
    border: 1px solid #e2e5e9;
    border-radius: 999px;
    background: #fff;
    color: #5d6673;
    padding: 0 11px;
    font-size: 13px;
    font-weight: 650;
  }

  .send-button {
    margin-left: auto;
    border-color: #25282d;
    background: #25282d;
    color: #fff;
  }

  @media (max-width: 760px) {
    .scorel-webui-shell {
      grid-template-columns: 1fr;
    }

    .webui-sidebar {
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid #dfe2e7;
    }

    .connection-card {
      margin-top: 0;
    }

    .main-header {
      padding: 0 18px;
    }

    .session-stream {
      padding: 30px 14px 20px;
    }

    .composer-wrap {
      padding: 0 14px 18px;
    }
  }
`;

export const renderWebUiShell = (): string => `
  <style data-scorel-webui-styles>${webUiStyles}</style>
  <main class="scorel-webui-shell">
    <aside class="webui-sidebar" data-region="sidebar" aria-label="Projects and sessions">
      <div class="sidebar-topbar" aria-label="Window controls and shortcuts">
        <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="sidebar-actions" aria-label="Navigation shortcuts">
          <span>⌘K</span>
          <span>New</span>
        </div>
      </div>

      <nav aria-label="Projects">
        <p class="section-label">Projects</p>
        <ul class="project-list">
          <li class="nav-row is-active"><span class="glyph">S</span><span>Scorel</span><span class="badge">2</span></li>
          <li class="nav-row"><span class="glyph">D</span><span>Default</span><span class="badge">82</span></li>
          <li class="nav-row"><span class="glyph">U</span><span>Unsorted</span><span class="badge">23</span></li>
        </ul>
      </nav>

      <nav aria-label="Sessions">
        <p class="section-label">Sessions</p>
        <ul class="session-list">
          <li class="nav-row is-active"><span class="glyph">1</span><span>S0031 WebUI information architecture</span><span class="badge">now</span></li>
          <li class="nav-row"><span class="glyph">2</span><span>S0030 WebUI baseline</span><span class="badge">done</span></li>
        </ul>
      </nav>

      <section class="connection-card" aria-label="Remote daemon">
        <h2>Remote daemon</h2>
        <p>Connect to an existing Scorel daemon. Credentials stay in memory for this page session.</p>
        <form data-connect-form>
          <label>
            WebSocket endpoint
            <input name="url" autocomplete="off" placeholder="ws://127.0.0.1:5050" required />
          </label>
          <label>
            Token
            <input name="token" autocomplete="off" type="password" required />
          </label>
          <label>
            Session id
            <input name="sessionId" autocomplete="off" placeholder="ses_..." required />
          </label>
          <button class="connect-button" type="submit">Connect</button>
        </form>
        <p class="connection-status" data-status data-state="idle">Disconnected</p>
        <div class="connection-facts" aria-label="Remote connection details">
          <div><span>Identity</span><span data-identity>Not connected</span></div>
          <div><span>Resync</span><span data-resync-mode>-</span></div>
          <div><span>Persistent seq</span><span data-persistent-seq>-</span></div>
          <div><span>Stream seq</span><span data-stream-seq>-</span></div>
        </div>
        <button class="reconnect-button" data-reconnect-button type="button">Reconnect</button>
      </section>
    </aside>

    <section class="webui-main" aria-label="Session workspace">
      <header class="main-header">
        <h1>Scorel WebUI</h1>
        <div class="header-meta">Remote control · WebSocket · Thin client</div>
      </header>

      <section class="session-stream" data-region="session-stream" aria-label="Session stream">
        <div class="stream-column">
          <div class="hero-empty">
            <div class="scorel-mark" aria-hidden="true">S</div>
            <h2>今天聊点什么？</h2>
            <p>Connect to a remote daemon to watch the shared session.</p>
          </div>

          <div data-event-stream>
          <article class="event-card">
            <p class="event-kicker">Session stream</p>
            <h3>Ready for daemon events</h3>
            <p>User messages, assistant output, tool calls, and status events will appear here in the same shared session observed by CLI attach.</p>
          </article>
          </div>
        </div>
      </section>

      <footer class="composer-wrap" data-region="composer" aria-label="Prompt composer">
        <div class="composer-panel">
          <textarea class="composer-input" placeholder="Ask Scorel to continue this session"></textarea>
          <div class="composer-toolbar">
            <button class="tool-chip" type="button">Tools</button>
            <button class="tool-chip" type="button">Model</button>
            <button class="tool-chip" type="button">Cancel</button>
            <button class="send-button" type="button">Send</button>
          </div>
        </div>
      </footer>
    </section>
  </main>
`;
