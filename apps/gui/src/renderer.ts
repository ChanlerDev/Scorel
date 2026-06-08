import type {
  DirectoryListing,
  PersistentEvent,
  SessionId,
  SessionSummary,
} from "@scorel/protocol";

import type {
  GuiProjectRef,
  GuiProjectView,
  GuiRelayDeviceView,
  GuiRelayPairSessionView,
} from "./shared/ipc.js";

type GuiState = {
  hostState: string;
  hostMessage?: string;
  projects: GuiProjectView[];
  relayDevices: GuiRelayDeviceView[];
  selectedProjectKey: string | null;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  events: PersistentEvent[];
  relayUrl: string;
  pairSession: GuiRelayPairSessionView | null;
  remoteDeviceId: string | null;
  remotePath: string;
  remoteListing: DirectoryListing | null;
  busy: boolean;
  error: string | null;
};

const state: GuiState = {
  hostState: "starting",
  projects: [],
  relayDevices: [],
  selectedProjectKey: null,
  sessions: [],
  selectedSessionId: null,
  events: [],
  relayUrl: "",
  pairSession: null,
  remoteDeviceId: null,
  remotePath: "",
  remoteListing: null,
  busy: false,
  error: null,
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const projectKey = (project: GuiProjectView): string =>
  project.source === "local" ? `local:${project.projectId}` : `relay:${project.deviceId}:${project.projectId}`;

const projectRef = (project: GuiProjectView): GuiProjectRef =>
  project.source === "local"
    ? { source: "local", projectId: project.projectId }
    : { source: "relay", deviceId: project.deviceId, projectId: project.projectId };

const selectedProject = (): GuiProjectView | undefined =>
  state.projects.find((project) => projectKey(project) === state.selectedProjectKey);

const setBusy = (busy: boolean): void => {
  state.busy = busy;
  render();
};

const setError = (cause: unknown): void => {
  state.error = cause instanceof Error ? cause.message : String(cause);
  render();
};

const refreshSnapshot = async (): Promise<void> => {
  const [status, snapshot] = await Promise.all([
    window.scorel.getHostStatus(),
    window.scorel.getSnapshot(),
  ]);
  state.hostState = status.state;
  state.hostMessage = status.message;
  state.projects = snapshot.projects;
  state.relayDevices = snapshot.relayDevices;
  if (!state.remoteDeviceId || !state.relayDevices.some((device) => device.deviceId === state.remoteDeviceId)) {
    state.remoteDeviceId = state.relayDevices[0]?.deviceId ?? null;
  }
  if (!state.selectedProjectKey || !state.projects.some((project) => projectKey(project) === state.selectedProjectKey)) {
    state.selectedProjectKey = state.projects[0] ? projectKey(state.projects[0]) : null;
  }
};

const refreshSessions = async (): Promise<void> => {
  const project = selectedProject();
  state.sessions = project ? await window.scorel.listSessions(projectRef(project)) : [];
  if (!state.selectedSessionId || !state.sessions.some((session) => session.sessionId === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions[0]?.sessionId ?? null;
  }
  state.events = project && state.selectedSessionId
    ? await window.scorel.openSession(projectRef(project), state.selectedSessionId)
    : [];
};

const selectProject = async (key: string): Promise<void> => {
  setBusy(true);
  try {
    state.selectedProjectKey = key;
    state.selectedSessionId = null;
    state.events = [];
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const selectSession = async (sessionId: string): Promise<void> => {
  const project = selectedProject();
  if (!project) return;
  setBusy(true);
  try {
    state.selectedSessionId = sessionId;
    state.events = await window.scorel.openSession(projectRef(project), sessionId);
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const addLocalProject = async (): Promise<void> => {
  setBusy(true);
  try {
    const project = await window.scorel.addLocalProject();
    await refreshSnapshot();
    if (project) state.selectedProjectKey = `local:${project.projectId}`;
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const createRelayPairSession = async (): Promise<void> => {
  setBusy(true);
  try {
    const relayUrl = relayUrlInput();
    state.pairSession = await window.scorel.createRelayPairSession(relayUrl || undefined);
    state.relayUrl = state.pairSession.relayUrl;
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const refreshRelayDevices = async (): Promise<void> => {
  setBusy(true);
  try {
    await window.scorel.refreshRelayDevices(relayUrlInput() || state.pairSession?.relayUrl || undefined);
    await refreshSnapshot();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const browseRemote = async (path?: string): Promise<void> => {
  if (!state.remoteDeviceId) return;
  setBusy(true);
  try {
    state.remoteListing = await window.scorel.listRemoteDirectories(state.remoteDeviceId, path || state.remotePath || undefined);
    state.remotePath = state.remoteListing.path;
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const addRemoteProject = async (): Promise<void> => {
  if (!state.remoteDeviceId || !state.remotePath) return;
  setBusy(true);
  try {
    const project = await window.scorel.addRemoteProject(state.remoteDeviceId, state.remotePath);
    await refreshSnapshot();
    state.selectedProjectKey = projectKey(project);
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const newSession = async (): Promise<void> => {
  const project = selectedProject();
  if (!project) return;
  setBusy(true);
  try {
    const sessionId = await window.scorel.createSession(projectRef(project));
    await refreshSessions();
    state.selectedSessionId = sessionId;
    state.events = await window.scorel.openSession(projectRef(project), sessionId);
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const sendMessage = async (event: SubmitEvent): Promise<void> => {
  event.preventDefault();
  const project = selectedProject();
  if (!project || !state.selectedSessionId) return;
  const form = event.currentTarget as HTMLFormElement;
  const input = form.elements.namedItem("message") as HTMLTextAreaElement | null;
  const content = input?.value.trim() ?? "";
  if (!content) return;
  input!.value = "";
  setBusy(true);
  try {
    state.events = await window.scorel.sendMessage(projectRef(project), state.selectedSessionId as SessionId, content);
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const relayUrlInput = (): string =>
  document.querySelector<HTMLInputElement>("[data-testid='relay-url']")?.value.trim() ?? state.relayUrl.trim();

const persistentMessageText = (event: PersistentEvent): { role: string; text: string } | null => {
  if (event.type !== "user_message" && event.type !== "assistant_message") return null;
  return {
    role: event.type === "user_message" ? "user" : "assistant",
    text: event.message.content
      .map((block) => block.type === "text" ? block.text : `[${block.type}]`)
      .join("\n"),
  };
};

const render = (): void => {
  const root = document.getElementById("root");
  if (!root) return;

  const project = selectedProject();
  const selectedSession = state.sessions.find((session) => session.sessionId === state.selectedSessionId);
  const messages = state.events.map(persistentMessageText).filter((message): message is { role: string; text: string } => Boolean(message));

  root.innerHTML = `
    <aside class="project-pane">
      <div class="brand">Scorel</div>
      <button class="primary-action" data-action="add-local-project" ${state.busy ? "disabled" : ""}>Add Local</button>
      <div class="section-label">Projects</div>
      <ul class="project-list" data-testid="project-list">
        ${
          state.projects.length === 0
            ? "<li class=\"muted\">No projects yet</li>"
            : state.projects.map((candidate) => `
              <li>
                <button class="nav-row ${projectKey(candidate) === state.selectedProjectKey ? "active" : ""}" data-project-key="${escapeHtml(projectKey(candidate))}">
                  <span>${escapeHtml(candidate.displayName)}</span>
                  <small>${candidate.source === "local" ? "Local" : escapeHtml(candidate.deviceId)} · ${escapeHtml(candidate.workDir)}</small>
                </button>
              </li>
            `).join("")
        }
      </ul>
      <div class="settings-panel">
        <div class="section-label">Relay Devices</div>
        <input data-testid="relay-url" placeholder="Relay URL" value="${escapeHtml(state.relayUrl)}" />
        <div class="button-row">
          <button data-action="create-pair" ${state.busy ? "disabled" : ""}>Pair</button>
          <button data-action="refresh-devices" ${state.busy ? "disabled" : ""}>Refresh</button>
        </div>
        ${state.pairSession ? `
          <div class="pair-code">
            <span>${escapeHtml(state.pairSession.pairCode)}</span>
            <small>Run scorel pair ${escapeHtml(state.pairSession.pairCode)}</small>
          </div>
        ` : ""}
        <ul class="device-list">
          ${
            state.relayDevices.length === 0
              ? "<li class=\"muted\">No Relay Devices</li>"
              : state.relayDevices.map((device) => `
                <li>
                  <button class="nav-row ${device.deviceId === state.remoteDeviceId ? "active" : ""}" data-device-id="${escapeHtml(device.deviceId)}">
                    <span>${escapeHtml(device.label)}</span>
                    <small>${device.online ? "online" : "offline"} · ${escapeHtml(device.relayUrl)}</small>
                  </button>
                </li>
              `).join("")
          }
        </ul>
      </div>
      <div class="settings-panel">
        <div class="section-label">Add Remote Project</div>
        <input data-testid="remote-path" placeholder="Remote path" value="${escapeHtml(state.remotePath)}" ${!state.remoteDeviceId || state.busy ? "disabled" : ""} />
        <div class="button-row">
          <button data-action="browse-remote" ${!state.remoteDeviceId || state.busy ? "disabled" : ""}>Browse</button>
          <button data-action="add-remote-project" ${!state.remoteDeviceId || !state.remotePath || state.busy ? "disabled" : ""}>Add</button>
        </div>
        <ul class="directory-list">
          ${
            state.remoteListing
              ? state.remoteListing.entries.map((entry) => `
                <li><button class="directory-row" data-remote-dir="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button></li>
              `).join("") || "<li class=\"muted\">No child directories</li>"
              : "<li class=\"muted\">Select a Relay Device and browse</li>"
          }
        </ul>
      </div>
    </aside>
    <section class="session-pane">
      <div class="pane-header">
        <div>
          <div class="section-label">Sessions</div>
          <strong>${escapeHtml(project?.displayName ?? "No Project")}</strong>
        </div>
        <button data-action="new-session" ${!project || state.busy ? "disabled" : ""}>New</button>
      </div>
      <ul class="session-list" data-testid="session-list">
        ${
          state.sessions.length === 0
            ? "<li class=\"muted\">No sessions</li>"
            : state.sessions.map((session) => `
              <li>
                <button class="nav-row ${session.sessionId === state.selectedSessionId ? "active" : ""}" data-session-id="${escapeHtml(session.sessionId)}">
                  <span>${escapeHtml(session.title ?? "Untitled session")}</span>
                  <small>seq ${session.currentSeq}</small>
                </button>
              </li>
            `).join("")
        }
      </ul>
    </section>
    <main class="workspace">
      <div class="workspace-status">
        <span data-testid="host-status">${escapeHtml(state.hostState)}</span>
        ${project?.source === "relay" ? `<span>${escapeHtml(project.deviceId)}</span>` : ""}
        ${state.error ? `<span class="error">${escapeHtml(state.error)}</span>` : ""}
        ${state.hostMessage ? `<span class="error">${escapeHtml(state.hostMessage)}</span>` : ""}
      </div>
      <div class="transcript" data-testid="transcript">
        ${
          selectedSession
            ? messages.map((message) => `
              <article class="message ${message.role}">
                <div class="role">${message.role}</div>
                <p>${escapeHtml(message.text)}</p>
              </article>
            `).join("") || "<p class=\"empty\">Start the session with a prompt.</p>"
            : "<h1>What should we build in Scorel?</h1>"
        }
      </div>
      <form class="composer" data-testid="composer">
        <textarea name="message" placeholder="Message Scorel..." ${!state.selectedSessionId || state.busy ? "disabled" : ""}></textarea>
        <button type="submit" ${!state.selectedSessionId || state.busy ? "disabled" : ""}>Send</button>
      </form>
    </main>
  `;

  wireEvents(root);
};

const wireEvents = (root: HTMLElement): void => {
  root.querySelector<HTMLElement>("[data-action='add-local-project']")?.addEventListener("click", () => void addLocalProject());
  root.querySelector<HTMLElement>("[data-action='create-pair']")?.addEventListener("click", () => void createRelayPairSession());
  root.querySelector<HTMLElement>("[data-action='refresh-devices']")?.addEventListener("click", () => void refreshRelayDevices());
  root.querySelector<HTMLElement>("[data-action='browse-remote']")?.addEventListener("click", () => {
    state.remotePath = document.querySelector<HTMLInputElement>("[data-testid='remote-path']")?.value.trim() ?? state.remotePath;
    void browseRemote(state.remotePath);
  });
  root.querySelector<HTMLElement>("[data-action='add-remote-project']")?.addEventListener("click", () => {
    state.remotePath = document.querySelector<HTMLInputElement>("[data-testid='remote-path']")?.value.trim() ?? state.remotePath;
    void addRemoteProject();
  });
  root.querySelector<HTMLElement>("[data-action='new-session']")?.addEventListener("click", () => void newSession());
  for (const item of root.querySelectorAll<HTMLElement>("[data-project-key]")) {
    item.addEventListener("click", () => void selectProject(item.dataset.projectKey!));
  }
  for (const item of root.querySelectorAll<HTMLElement>("[data-session-id]")) {
    item.addEventListener("click", () => void selectSession(item.dataset.sessionId!));
  }
  for (const item of root.querySelectorAll<HTMLElement>("[data-device-id]")) {
    item.addEventListener("click", () => {
      state.remoteDeviceId = item.dataset.deviceId!;
      render();
    });
  }
  for (const item of root.querySelectorAll<HTMLElement>("[data-remote-dir]")) {
    item.addEventListener("click", () => void browseRemote(item.dataset.remoteDir!));
  }
  root.querySelector<HTMLFormElement>("[data-testid='composer']")?.addEventListener("submit", (event) => void sendMessage(event));
};

const boot = async (): Promise<void> => {
  setBusy(true);
  try {
    await refreshSnapshot();
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

void boot();
