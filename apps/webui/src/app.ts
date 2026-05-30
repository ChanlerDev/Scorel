import { asSessionId } from "@scorel/protocol";

import type { RemoteSessionState } from "./remote-session.js";
import { createRemoteSessionController } from "./remote-session.js";
import { renderEventStreamRows } from "./event-stream.js";
import { createRemoteProfileStore, type RemoteProfile, type RemoteProfileStore } from "./remote-store.js";
import { renderDeviceTree, renderSessionBrowser } from "./session-browser.js";
import { renderWebUiShell } from "./shell.js";

const renderState = (
  root: HTMLElement,
  state: RemoteSessionState,
  options: { store: RemoteProfileStore; activeProfile?: RemoteProfile },
): void => {
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
  const deviceTree = root.querySelector<HTMLElement>("[data-device-tree]");
  const sessionTree = root.querySelector<HTMLElement>("[data-session-tree]");
  if (deviceTree && sessionTree && state.status === "connected") {
    deviceTree.innerHTML = renderDeviceTree({
      devices: [{
        id: options.activeProfile?.id ?? state.syncIndex.remoteId,
        name: options.activeProfile?.name ?? identityText(state),
        projects: state.sessionBrowser.projects,
      }],
      selectedProjectKey: state.sessionBrowser.selectedProjectKey,
      selectedSessionId: state.sessionBrowser.selectedSessionId,
    });
    const rendered = renderSessionBrowser(state.sessionBrowser);
    sessionTree.innerHTML = rendered.tree;
    const projectKey = state.sessionBrowser.selectedProjectKey;
    if (options.activeProfile && projectKey && state.sessionId) {
      options.store.saveSelection(options.activeProfile.id, { projectKey, sessionId: String(state.sessionId) });
      options.store.saveSessionAnchors(options.activeProfile.id, projectKey, String(state.sessionId), {
        persistentLastSeq: Number(state.persistentLastSeq),
        streamLastSeq: Number(state.streamLastSeq),
      });
    }
  }
};

export const mountWebUi = (root: HTMLElement): void => {
  root.innerHTML = renderWebUiShell();
  const controller = createRemoteSessionController();
  const store = createRemoteProfileStore();
  let activeProfile = store.listProfiles()[0];

  if (activeProfile) {
    populateRemoteForm(root, activeProfile);
  }

  renderStoredDevices(root, store.listProfiles());

  const form = root.querySelector<HTMLFormElement>("[data-device-settings-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    activeProfile = store.saveProfile({
      id: activeProfile?.id,
      name: String(data.get("name") ?? "").trim(),
      endpoint: String(data.get("endpoint") ?? "").trim(),
      token: String(data.get("token") ?? ""),
    });
    renderStoredDevices(root, store.listProfiles());
    const url = activeProfile.endpoint;
    const token = String(data.get("token") ?? "");
    const sessionId = activeProfile.lastSelection?.sessionId;

    void controller
      .connect({
        url,
        token,
        sessionId,
        remoteId: activeProfile.id,
      })
      .then((state) => {
        renderState(root, state, { store, activeProfile });
        if (state.status === "connected") {
          showPage(root, "chat");
        }
      });
  });

  root.querySelector<HTMLElement>("[data-device-tree]")?.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>("[data-session-id]");
    const sessionId = button?.dataset.sessionId;
    if (!sessionId) {
      return;
    }
    showPage(root, "chat");
    void controller.loadSession(asSessionId(sessionId)).then((state) => renderState(root, state, { store, activeProfile }));
  });

  root.querySelector<HTMLFormElement>("[data-composer-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLTextAreaElement>("[data-prompt-input]");
    void controller.sendPrompt(input?.value ?? "").then((state) => {
      if (state.status === "connected" && state.composer.status === "sent" && input) {
        input.value = "";
      }
      renderState(root, state, { store, activeProfile });
    });
  });

  root.querySelector<HTMLButtonElement>("[data-cancel-button]")?.addEventListener("click", () => {
    void controller.cancel().then((state) => renderState(root, state, { store, activeProfile }));
  });

  root.querySelector<HTMLElement>("[data-settings-button]")?.addEventListener("click", () => {
    showPage(root, "settings");
  });
};

const renderStoredDevices = (root: HTMLElement, profiles: RemoteProfile[]): void => {
  const tree = root.querySelector<HTMLElement>("[data-device-tree]");
  if (!tree) {
    return;
  }
  tree.innerHTML = profiles.length === 0
    ? '<li class="tree-empty"><span class="tree-icon">-</span><span>No devices configured</span></li>'
    : renderDeviceTree({
      devices: profiles.map((profile) => ({ id: profile.id, name: profile.name, projects: [] })),
      selectedProjectKey: null,
      selectedSessionId: null,
    });
};

const populateRemoteForm = (root: HTMLElement, profile: RemoteProfile): void => {
  const form = root.querySelector<HTMLFormElement>("[data-device-settings-form]");
  if (!form) {
    return;
  }
  const name = form.elements.namedItem("name") as HTMLInputElement | null;
  const endpoint = form.elements.namedItem("endpoint") as HTMLInputElement | null;
  const token = form.elements.namedItem("token") as HTMLInputElement | null;
  if (name) {
    name.value = profile.name;
  }
  if (endpoint) {
    endpoint.value = profile.endpoint;
  }
  if (token) {
    token.value = profile.token;
  }
};

const showPage = (root: HTMLElement, page: "chat" | "settings"): void => {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-page]"))) {
    element.classList.toggle("is-visible", element.dataset.page === page);
  }
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
      return state.sessionId ? `Connecting to ${state.sessionId}...` : "Connecting to remote...";
    case "connected":
      return state.sessionId ? `Connected to ${state.sessionId}` : "Connected. Choose a session.";
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

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
