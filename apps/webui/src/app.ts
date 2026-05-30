import { asClientId, asSessionId } from "@scorel/protocol";

import { connectToRemoteSession } from "./connection.js";

type WebUiState = {
  status: "idle" | "connecting" | "connected" | "error";
  message: string;
};

const setState = (root: HTMLElement, state: WebUiState): void => {
  const status = root.querySelector<HTMLElement>("[data-status]");
  if (status) {
    status.dataset.state = state.status;
    status.textContent = state.message;
  }
};

export const mountWebUi = (root: HTMLElement): void => {
  root.innerHTML = `
    <main class="scorel-webui-shell">
      <section>
        <p class="eyebrow">Scorel M5 WebUI</p>
        <h1>Connect to a remote daemon session</h1>
        <p>Use the existing WebSocket daemon transport. Tokens stay in memory for this page session.</p>
      </section>
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
        <button type="submit">Connect</button>
      </form>
      <p data-status data-state="idle">Disconnected</p>
    </main>
  `;

  const form = root.querySelector<HTMLFormElement>("[data-connect-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const url = String(data.get("url") ?? "").trim();
    const token = String(data.get("token") ?? "");
    const sessionId = String(data.get("sessionId") ?? "").trim();

    setState(root, { status: "connecting", message: "Connecting..." });
    void connectToRemoteSession({
      url,
      token,
      sessionId: asSessionId(sessionId),
      clientId: asClientId(`webui_${crypto.randomUUID()}`),
    })
      .then(({ identity }) => {
        const label = identity.deviceDisplayName ?? identity.deviceId ?? "remote daemon";
        setState(root, { status: "connected", message: `Connected to ${label}` });
      })
      .catch((error: unknown) => {
        setState(root, {
          status: "error",
          message: error instanceof Error ? error.message : "Connection failed",
        });
      });
  });
};
