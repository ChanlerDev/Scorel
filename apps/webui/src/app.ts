import type { RemoteSessionState } from "./remote-session.js";
import { createRemoteSessionController } from "./remote-session.js";
import { renderWebUiShell } from "./shell.js";

const renderState = (root: HTMLElement, state: RemoteSessionState): void => {
  const status = root.querySelector<HTMLElement>("[data-status]");
  if (status) {
    status.dataset.state = state.status;
    status.textContent = statusText(state);
  }
  setText(root, "[data-identity]", identityText(state));
  setText(root, "[data-resync-mode]", state.status === "connected" ? state.resyncMode : "-");
  setText(root, "[data-persistent-seq]", state.status === "connected" ? String(state.persistentLastSeq) : "-");
  setText(root, "[data-stream-seq]", state.status === "connected" ? String(state.streamLastSeq) : "-");
};

export const mountWebUi = (root: HTMLElement): void => {
  root.innerHTML = renderWebUiShell();
  const controller = createRemoteSessionController();

  const form = root.querySelector<HTMLFormElement>("[data-connect-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const url = String(data.get("url") ?? "").trim();
    const token = String(data.get("token") ?? "");
    const sessionId = String(data.get("sessionId") ?? "").trim();

    void controller
      .connect({
      url,
      token,
        sessionId,
    })
      .then((state) => renderState(root, state));
  });

  root.querySelector<HTMLButtonElement>("[data-reconnect-button]")?.addEventListener("click", () => {
    void controller.reconnect().then((state) => renderState(root, state));
  });
};

const setText = (root: HTMLElement, selector: string, text: string): void => {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) {
    element.textContent = text;
  }
};

const statusText = (state: RemoteSessionState): string => {
  switch (state.status) {
    case "disconnected":
      return "Disconnected";
    case "connecting":
      return `Connecting to ${state.sessionId}...`;
    case "connected":
      return `Connected to ${state.sessionId}`;
    case "error":
      return state.message;
  }
};

const identityText = (state: RemoteSessionState): string => {
  if (state.status !== "connected") {
    return "Not connected";
  }
  const display = state.identity.deviceDisplayName ?? state.identity.deviceId ?? "remote daemon";
  return state.identity.projectSlug ? `${display} · ${state.identity.projectSlug}` : display;
};
