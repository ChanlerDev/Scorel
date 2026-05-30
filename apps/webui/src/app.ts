import { asSessionId } from "@scorel/protocol";

import type { RemoteSessionState } from "./remote-session.js";
import { createRemoteSessionController } from "./remote-session.js";
import { renderEventStreamRows } from "./event-stream.js";
import { renderSessionBrowser } from "./session-browser.js";
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
  setText(root, "[data-composer-status]", state.status === "connected" ? state.composer.message : "Connect before sending prompts");
  const promptInput = root.querySelector<HTMLTextAreaElement>("[data-prompt-input]");
  const sendButton = root.querySelector<HTMLButtonElement>("[data-send-button]");
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-cancel-button]");
  const isConnected = state.status === "connected";
  if (promptInput) {
    promptInput.disabled = !isConnected;
  }
  if (sendButton) {
    sendButton.disabled = !isConnected || state.status === "connected" && state.composer.status === "sending";
  }
  if (cancelButton) {
    cancelButton.disabled = !isConnected || state.status === "connected" && state.composer.status === "cancelling";
  }
  const stream = root.querySelector<HTMLElement>("[data-event-stream]");
  if (stream && state.status === "connected") {
    stream.innerHTML = renderEventStreamRows(state.events);
  }
  const sessionList = root.querySelector<HTMLElement>("[data-session-list]");
  const sessionTree = root.querySelector<HTMLElement>("[data-session-tree]");
  if (sessionList && sessionTree && state.status === "connected") {
    const rendered = renderSessionBrowser(state.sessionBrowser);
    sessionList.innerHTML = rendered.sessions;
    sessionTree.innerHTML = rendered.tree;
  }
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

  root.querySelector<HTMLElement>("[data-session-list]")?.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>("[data-session-id]");
    const sessionId = button?.dataset.sessionId;
    if (!sessionId) {
      return;
    }
    void controller.loadSession(asSessionId(sessionId)).then((state) => renderState(root, state));
  });

  root.querySelector<HTMLFormElement>("[data-composer-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLTextAreaElement>("[data-prompt-input]");
    void controller.sendPrompt(input?.value ?? "").then((state) => {
      if (state.status === "connected" && state.composer.status === "sent" && input) {
        input.value = "";
      }
      renderState(root, state);
    });
  });

  root.querySelector<HTMLButtonElement>("[data-cancel-button]")?.addEventListener("click", () => {
    void controller.cancel().then((state) => renderState(root, state));
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
