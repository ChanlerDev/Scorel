import type { HostProject, PersistentEvent, SessionId, SessionSummary } from "@scorel/protocol";

type GuiState = {
  hostState: string;
  hostMessage?: string;
  projects: HostProject[];
  selectedProjectId: string | null;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  events: PersistentEvent[];
  busy: boolean;
  error: string | null;
};

const state: GuiState = {
  hostState: "starting",
  projects: [],
  selectedProjectId: null,
  sessions: [],
  selectedSessionId: null,
  events: [],
  busy: false,
  error: null,
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const setBusy = (busy: boolean): void => {
  state.busy = busy;
  render();
};

const setError = (cause: unknown): void => {
  state.error = cause instanceof Error ? cause.message : String(cause);
  render();
};

const refreshProjects = async (): Promise<void> => {
  const status = await window.scorel.getHostStatus();
  state.hostState = status.state;
  state.hostMessage = status.message;
  state.projects = await window.scorel.listLocalProjects();
  if (!state.selectedProjectId || !state.projects.some((project) => project.projectId === state.selectedProjectId)) {
    state.selectedProjectId = state.projects[0]?.projectId ?? null;
  }
};

const refreshSessions = async (): Promise<void> => {
  state.sessions = state.selectedProjectId ? await window.scorel.listLocalSessions(state.selectedProjectId) : [];
  if (!state.selectedSessionId || !state.sessions.some((session) => session.sessionId === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions[0]?.sessionId ?? null;
  }
  state.events = state.selectedSessionId ? await window.scorel.openLocalSession(state.selectedSessionId) : [];
};

const selectProject = async (projectId: string): Promise<void> => {
  setBusy(true);
  try {
    state.selectedProjectId = projectId;
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
  setBusy(true);
  try {
    state.selectedSessionId = sessionId;
    state.events = await window.scorel.openLocalSession(sessionId);
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const addProject = async (): Promise<void> => {
  setBusy(true);
  try {
    const project = await window.scorel.addLocalProject();
    await refreshProjects();
    if (project) state.selectedProjectId = project.projectId;
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const newSession = async (): Promise<void> => {
  if (!state.selectedProjectId) return;
  setBusy(true);
  try {
    const sessionId = await window.scorel.createLocalSession(state.selectedProjectId);
    await refreshSessions();
    state.selectedSessionId = sessionId;
    state.events = await window.scorel.openLocalSession(sessionId);
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

const sendMessage = async (event: SubmitEvent): Promise<void> => {
  event.preventDefault();
  if (!state.selectedSessionId) return;
  const form = event.currentTarget as HTMLFormElement;
  const input = form.elements.namedItem("message") as HTMLTextAreaElement | null;
  const content = input?.value.trim() ?? "";
  if (!content) return;
  input!.value = "";
  setBusy(true);
  try {
    state.events = await window.scorel.sendLocalMessage(state.selectedSessionId as SessionId, content);
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

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

  const selectedProject = state.projects.find((project) => project.projectId === state.selectedProjectId);
  const selectedSession = state.sessions.find((session) => session.sessionId === state.selectedSessionId);
  const messages = state.events.map(persistentMessageText).filter((message): message is { role: string; text: string } => Boolean(message));

  root.innerHTML = `
    <aside class="project-pane">
      <div class="brand">Scorel</div>
      <button class="primary-action" data-action="add-project" ${state.busy ? "disabled" : ""}>Add Project</button>
      <div class="section-label">Projects</div>
      <ul class="project-list" data-testid="project-list">
        ${
          state.projects.length === 0
            ? "<li class=\"muted\">No local projects yet</li>"
            : state.projects.map((project) => `
              <li>
                <button class="nav-row ${project.projectId === state.selectedProjectId ? "active" : ""}" data-project-id="${escapeHtml(project.projectId)}">
                  <span>${escapeHtml(project.displayName)}</span>
                  <small>${escapeHtml(project.workDir)}</small>
                </button>
              </li>
            `).join("")
        }
      </ul>
    </aside>
    <section class="session-pane">
      <div class="pane-header">
        <div>
          <div class="section-label">Sessions</div>
          <strong>${escapeHtml(selectedProject?.displayName ?? "No Project")}</strong>
        </div>
        <button data-action="new-session" ${!state.selectedProjectId || state.busy ? "disabled" : ""}>New</button>
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
  root.querySelector<HTMLElement>("[data-action='add-project']")?.addEventListener("click", () => void addProject());
  root.querySelector<HTMLElement>("[data-action='new-session']")?.addEventListener("click", () => void newSession());
  for (const item of root.querySelectorAll<HTMLElement>("[data-project-id]")) {
    item.addEventListener("click", () => void selectProject(item.dataset.projectId!));
  }
  for (const item of root.querySelectorAll<HTMLElement>("[data-session-id]")) {
    item.addEventListener("click", () => void selectSession(item.dataset.sessionId!));
  }
  root.querySelector<HTMLFormElement>("[data-testid='composer']")?.addEventListener("submit", (event) => void sendMessage(event));
};

const boot = async (): Promise<void> => {
  setBusy(true);
  try {
    await refreshProjects();
    await refreshSessions();
    state.error = null;
  } catch (cause) {
    setError(cause);
  } finally {
    setBusy(false);
  }
};

void boot();
