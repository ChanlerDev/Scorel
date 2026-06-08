import { Popover } from "@base-ui/react/popover";
import type { DirectoryListing, PersistentEvent, SessionId, SessionSummary } from "@scorel/protocol";
import React from "react";
import { createRoot } from "react-dom/client";

import type {
  GuiProjectRef,
  GuiProjectView,
  GuiRelayDeviceView,
  GuiRelayPairSessionView,
} from "./shared/ipc.js";

type MessageView = {
  role: "user" | "assistant";
  text: string;
};

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

const initialState: GuiState = {
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

const projectKey = (project: GuiProjectView): string =>
  project.source === "local" ? `local:${project.projectId}` : `relay:${project.deviceId}:${project.projectId}`;

const projectRef = (project: GuiProjectView): GuiProjectRef =>
  project.source === "local"
    ? { source: "local", projectId: project.projectId }
    : { source: "relay", deviceId: project.deviceId, projectId: project.projectId };

const sourceLabel = (project: GuiProjectView | undefined): string => {
  if (!project) return "选择项目";
  return project.source === "local" ? "本地模式" : "Relay";
};

const messageView = (event: PersistentEvent): MessageView | null => {
  if (event.type !== "user_message" && event.type !== "assistant_message") return null;
  return {
    role: event.type === "user_message" ? "user" : "assistant",
    text: event.message.content
      .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
      .join("\n"),
  };
};

const App = (): React.ReactElement => {
  const [state, setState] = React.useState<GuiState>(initialState);
  const [message, setMessage] = React.useState("");
  const relayUrlRef = React.useRef<HTMLInputElement>(null);
  const remotePathRef = React.useRef<HTMLInputElement>(null);

  const patch = React.useCallback((partial: Partial<GuiState>) => {
    setState((current) => ({ ...current, ...partial }));
  }, []);

  const setError = React.useCallback((cause: unknown) => {
    patch({ error: cause instanceof Error ? cause.message : String(cause), busy: false });
  }, [patch]);

  const selectedProject = React.useMemo(
    () => state.projects.find((project) => projectKey(project) === state.selectedProjectKey),
    [state.projects, state.selectedProjectKey],
  );
  const selectedSession = React.useMemo(
    () => state.sessions.find((session) => session.sessionId === state.selectedSessionId),
    [state.sessions, state.selectedSessionId],
  );
  const selectedRelayDevice = React.useMemo(
    () => selectedProject?.source === "relay"
      ? state.relayDevices.find((device) => device.deviceId === selectedProject.deviceId)
      : undefined,
    [selectedProject, state.relayDevices],
  );
  const messages = React.useMemo(
    () => state.events.map(messageView).filter((item): item is MessageView => Boolean(item)),
    [state.events],
  );

  const refreshSnapshot = React.useCallback(async (): Promise<GuiState> => {
    const [status, snapshot] = await Promise.all([
      window.scorel.getHostStatus(),
      window.scorel.getSnapshot(),
    ]);
    const nextSelectedProjectKey = state.selectedProjectKey && snapshot.projects.some(
      (project) => projectKey(project) === state.selectedProjectKey,
    )
      ? state.selectedProjectKey
      : snapshot.projects[0] ? projectKey(snapshot.projects[0]) : null;
    const nextRemoteDeviceId = state.remoteDeviceId && snapshot.relayDevices.some(
      (device) => device.deviceId === state.remoteDeviceId,
    )
      ? state.remoteDeviceId
      : snapshot.relayDevices[0]?.deviceId ?? null;

    const nextState = {
      ...state,
      hostState: status.state,
      hostMessage: status.message,
      projects: snapshot.projects,
      relayDevices: snapshot.relayDevices,
      selectedProjectKey: nextSelectedProjectKey,
      remoteDeviceId: nextRemoteDeviceId,
    };
    setState(nextState);
    return nextState;
  }, [state]);

  const refreshSessions = React.useCallback(async (inputState = state): Promise<void> => {
    const project = inputState.projects.find((candidate) => projectKey(candidate) === inputState.selectedProjectKey);
    const sessions = project ? await window.scorel.listSessions(projectRef(project)) : [];
    const selectedSessionId = inputState.selectedSessionId && sessions.some(
      (session) => session.sessionId === inputState.selectedSessionId,
    )
      ? inputState.selectedSessionId
      : sessions[0]?.sessionId ?? null;
    const events = project && selectedSessionId
      ? await window.scorel.openSession(projectRef(project), selectedSessionId)
      : [];
    patch({ sessions, selectedSessionId, events });
  }, [patch, state]);

  const boot = React.useCallback(async () => {
    patch({ busy: true });
    try {
      const nextState = await refreshSnapshot();
      await refreshSessions(nextState);
      patch({ busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  }, [patch, refreshSessions, refreshSnapshot, setError]);

  React.useEffect(() => {
    void boot();
  }, []);

  const selectProject = async (key: string): Promise<void> => {
    patch({ busy: true, selectedProjectKey: key, selectedSessionId: null, events: [] });
    try {
      const nextState = { ...state, selectedProjectKey: key, selectedSessionId: null, events: [] };
      await refreshSessions(nextState);
      patch({ busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const selectSession = async (sessionId: string): Promise<void> => {
    if (!selectedProject) return;
    patch({ busy: true, selectedSessionId: sessionId });
    try {
      const events = await window.scorel.openSession(projectRef(selectedProject), sessionId);
      patch({ events, busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const addLocalProject = async (): Promise<void> => {
    patch({ busy: true });
    try {
      const project = await window.scorel.addLocalProject();
      const nextState = await refreshSnapshot();
      if (project) nextState.selectedProjectKey = `local:${project.projectId}`;
      setState(nextState);
      await refreshSessions(nextState);
      patch({ busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const createRelayPairSession = async (): Promise<void> => {
    patch({ busy: true });
    try {
      const relayUrl = relayUrlRef.current?.value.trim() || state.relayUrl.trim() || undefined;
      const pairSession = await window.scorel.createRelayPairSession(relayUrl);
      patch({ pairSession, relayUrl: pairSession.relayUrl, busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const refreshRelayDevices = async (): Promise<void> => {
    patch({ busy: true });
    try {
      await window.scorel.refreshRelayDevices(relayUrlRef.current?.value.trim() || state.pairSession?.relayUrl || undefined);
      const nextState = await refreshSnapshot();
      patch({ ...nextState, busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const browseRemote = async (path?: string): Promise<void> => {
    if (!state.remoteDeviceId) return;
    patch({ busy: true });
    try {
      const remoteListing = await window.scorel.listRemoteDirectories(
        state.remoteDeviceId,
        path || remotePathRef.current?.value.trim() || state.remotePath || undefined,
      );
      patch({ remoteListing, remotePath: remoteListing.path, busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const addRemoteProject = async (): Promise<void> => {
    const remotePath = remotePathRef.current?.value.trim() || state.remotePath;
    if (!state.remoteDeviceId || !remotePath) return;
    patch({ busy: true });
    try {
      const project = await window.scorel.addRemoteProject(state.remoteDeviceId, remotePath);
      const nextState = await refreshSnapshot();
      nextState.selectedProjectKey = projectKey(project);
      setState(nextState);
      await refreshSessions(nextState);
      patch({ busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const newSession = async (): Promise<void> => {
    if (!selectedProject) return;
    patch({ busy: true });
    try {
      const selectedSessionId = await window.scorel.createSession(projectRef(selectedProject));
      await refreshSessions({ ...state, selectedSessionId });
      patch({ selectedSessionId, busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedProject) return;
    const content = message.trim();
    if (!content) return;
    setMessage("");
    patch({ busy: true });
    try {
      const selectedSessionId = state.selectedSessionId
        ?? await window.scorel.createSession(projectRef(selectedProject));
      const events = await window.scorel.sendMessage(projectRef(selectedProject), selectedSessionId as SessionId, content);
      await refreshSessions({ ...state, selectedSessionId, events });
      patch({ selectedSessionId, events, busy: false, error: null });
    } catch (cause) {
      setError(cause);
    }
  };

  const composerDisabled = !selectedProject || state.busy;
  const topbarTitle = selectedSession?.title ?? "";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-space" />
        <nav className="side-actions">
          <button className="side-action" type="button" disabled={!selectedProject || state.busy} onClick={() => void newSession()}>
            <span className="icon">◰</span><span className="label">新对话</span>
          </button>
          <button className="side-action" type="button" disabled><span className="icon">⌕</span><span className="label">搜索</span></button>
          <button className="side-action" type="button" disabled><span className="icon">⌘</span><span className="label">插件</span></button>
          <button className="side-action" type="button" disabled><span className="icon">◷</span><span className="label">自动化</span></button>
        </nav>
        <div className="side-scroll">
          <div className="section-header">
            <h2 className="section-title">项目</h2>
            <button className="mini-button" type="button" title="Add local Project" disabled={state.busy} onClick={() => void addLocalProject()}>+</button>
          </div>
          <ul className="project-list" data-testid="project-list">
            {state.projects.length === 0
              ? <li className="muted-row">还没有项目</li>
              : state.projects.map((project) => {
                const relayDevice = project.source === "relay"
                  ? state.relayDevices.find((device) => device.deviceId === project.deviceId)
                  : undefined;
                return (
                  <li key={projectKey(project)}>
                    <button
                      className={`project-row ${projectKey(project) === state.selectedProjectKey ? "active" : ""}`}
                      type="button"
                      onClick={() => void selectProject(projectKey(project))}
                    >
                      <span className="icon">▱</span>
                      <span>{project.displayName}</span>
                      <span className={`source-pill ${project.source === "local" ? "local" : ""} ${project.source === "relay" && !relayDevice?.online ? "offline" : ""}`} />
                    </button>
                  </li>
                );
              })}
          </ul>
          <div className="section-header">
            <h2 className="section-title">对话</h2>
          </div>
          <ul className="session-list" data-testid="session-list">
            {state.sessions.length === 0
              ? <li className="muted-row">暂无对话</li>
              : state.sessions.map((session) => (
                <li key={session.sessionId}>
                  <button
                    className={`session-row ${session.sessionId === state.selectedSessionId ? "active" : ""}`}
                    type="button"
                    onClick={() => void selectSession(session.sessionId)}
                  >
                    <span className="icon">·</span>
                    <span>{session.title ?? "Untitled session"}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
        <SettingsPopover
          state={state}
          relayUrlRef={relayUrlRef}
          remotePathRef={remotePathRef}
          onCreatePair={() => void createRelayPairSession()}
          onRefreshDevices={() => void refreshRelayDevices()}
          onSelectDevice={(deviceId) => patch({ remoteDeviceId: deviceId })}
          onBrowseRemote={(path) => void browseRemote(path)}
          onAddRemoteProject={() => void addRemoteProject()}
        />
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="title-wrap">
            {topbarTitle ? <div className="title">{topbarTitle}</div> : null}
            {topbarTitle ? <div className="ellipsis">•••</div> : null}
          </div>
          <div className="top-actions">
            {state.error ? <span className="error-line">{state.error}</span> : null}
            {state.hostMessage ? <span className="error-line">{state.hostMessage}</span> : null}
            <button className="toolbar-button" type="button" disabled>◩⌄</button>
            <button className="toolbar-button" type="button" disabled>☷</button>
            <button className="toolbar-button" type="button" disabled>▭</button>
          </div>
        </header>
        {selectedSession ? (
          <section className="content transcript-wrap">
            <div className="transcript" data-testid="transcript">
              {messages.length > 0 ? messages.map((item, index) => (
                <article className={`message ${item.role}`} key={`${item.role}-${index}`}>
                  <div className="role">{item.role}</div>
                  <p>{item.text}</p>
                </article>
              )) : <p className="empty">Start the session with a prompt.</p>}
            </div>
            <Composer
              disabled={composerDisabled}
              message={message}
              selectedProject={selectedProject}
              selectedRelayDevice={selectedRelayDevice}
              onAddLocalProject={() => void addLocalProject()}
              onMessageChange={setMessage}
              onSubmit={(event) => void sendMessage(event)}
            />
          </section>
        ) : (
          <section className="content empty-content">
            <div className="empty-stack">
              <h1>我们应该在 Scorel 中构建什么？</h1>
              <Composer
                disabled={composerDisabled}
                message={message}
                selectedProject={selectedProject}
                selectedRelayDevice={selectedRelayDevice}
                onAddLocalProject={() => void addLocalProject()}
                onMessageChange={setMessage}
                onSubmit={(event) => void sendMessage(event)}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

type ComposerProps = {
  disabled: boolean;
  message: string;
  selectedProject: GuiProjectView | undefined;
  selectedRelayDevice: GuiRelayDeviceView | undefined;
  onAddLocalProject(): void;
  onMessageChange(value: string): void;
  onSubmit(event: React.FormEvent<HTMLFormElement>): void;
};

const Composer = ({
  disabled,
  message,
  selectedProject,
  selectedRelayDevice,
  onAddLocalProject,
  onMessageChange,
  onSubmit,
}: ComposerProps): React.ReactElement => (
  <div className="composer-shell">
    <form className="composer" data-testid="composer" onSubmit={onSubmit}>
      <textarea
        name="message"
        placeholder="随心输入"
        disabled={disabled}
        value={message}
        onChange={(event) => onMessageChange(event.currentTarget.value)}
      />
      <div className="composer-bar">
        <div className="composer-left">
          <button className="round-button" type="button" disabled={disabled} onClick={onAddLocalProject}>+</button>
          <span className="access-pill">◇ 完全访问⌄</span>
        </div>
        <div />
        <div className="composer-right">
          <span className="model-pill">5.5 中⌄</span>
          <button className="round-button" type="button" disabled>♩</button>
          <button className="send-button" type="submit" disabled={disabled || message.trim().length === 0}>↑</button>
        </div>
      </div>
    </form>
    <div className="meta-row">
      <span className="meta-item">▱ <span>{selectedProject?.displayName ?? "选择项目"}</span>⌄</span>
      <span className="meta-item">▭ <span>{sourceLabel(selectedProject)}</span>⌄</span>
      <span className="meta-item">⌘ <span>main</span>⌄</span>
      {selectedProject?.source === "relay" ? (
        <span className="meta-item">{selectedRelayDevice?.online ? "●" : "○"} <span>{selectedProject.deviceId}</span></span>
      ) : null}
    </div>
  </div>
);

type SettingsPopoverProps = {
  state: GuiState;
  relayUrlRef: React.RefObject<HTMLInputElement>;
  remotePathRef: React.RefObject<HTMLInputElement>;
  onCreatePair(): void;
  onRefreshDevices(): void;
  onSelectDevice(deviceId: string): void;
  onBrowseRemote(path?: string): void;
  onAddRemoteProject(): void;
};

const SettingsPopover = ({
  state,
  relayUrlRef,
  remotePathRef,
  onCreatePair,
  onRefreshDevices,
  onSelectDevice,
  onBrowseRemote,
  onAddRemoteProject,
}: SettingsPopoverProps): React.ReactElement => (
  <div className="bottom-zone">
    <Popover.Root>
      <Popover.Trigger className="settings-button">
        <span className="icon">⚙</span><span>设置</span><span>▣</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={10}>
          <Popover.Popup className="settings-popover">
            <Popover.Title className="popover-title">Relay Devices</Popover.Title>
            <input ref={relayUrlRef} data-testid="relay-url" placeholder="Relay URL" defaultValue={state.relayUrl} />
            <div className="button-row">
              <button className="soft-button" type="button" disabled={state.busy} onClick={onCreatePair}>Pair</button>
              <button className="soft-button" type="button" disabled={state.busy} onClick={onRefreshDevices}>Refresh</button>
            </div>
            {state.pairSession ? (
              <div className="pair-code">
                <strong>{state.pairSession.pairCode}</strong>
                <small>Run scorel pair {state.pairSession.pairCode}</small>
              </div>
            ) : null}
            <div className="device-list">
              {state.relayDevices.length === 0 ? (
                <span className="hint">No Relay Devices</span>
              ) : state.relayDevices.map((device) => (
                <button
                  className={`device-row ${device.deviceId === state.remoteDeviceId ? "active" : ""}`}
                  key={device.deviceId}
                  type="button"
                  onClick={() => onSelectDevice(device.deviceId)}
                >
                  <span>{device.label}</span><span>{device.online ? "online" : "offline"}</span>
                </button>
              ))}
            </div>
            <Popover.Title className="popover-title">Add Remote Project</Popover.Title>
            <input
              ref={remotePathRef}
              data-testid="remote-path"
              placeholder="Remote path"
              defaultValue={state.remotePath}
              disabled={!state.remoteDeviceId || state.busy}
            />
            <div className="button-row">
              <button className="soft-button" type="button" disabled={!state.remoteDeviceId || state.busy} onClick={() => onBrowseRemote()}>
                Browse
              </button>
              <button className="soft-button" type="button" disabled={!state.remoteDeviceId || state.busy} onClick={onAddRemoteProject}>
                Add
              </button>
            </div>
            <div className="hint">
              {state.remoteListing
                ? `${state.remoteListing.entries.length} child directories`
                : state.remoteDeviceId ? "Browse a remote path" : "Refresh a Relay Device first"}
            </div>
            {state.remoteListing ? (
              <div className="directory-list">
                {state.remoteListing.entries.slice(0, 8).map((entry) => (
                  <button key={entry.path} type="button" onClick={() => onBrowseRemote(entry.path)}>
                    {entry.name}
                  </button>
                ))}
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  </div>
);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<App />);
