import type { PersistentEvent, ScorelEvent, SessionId, SessionSummary } from "@scorel/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { createRafBatcher } from "./chatbox/delta-batch.js";
import { AddRemoteProjectDialog } from "./composer/AddRemoteProjectDialog.js";
import { ProjectPickerMenu } from "./composer/ProjectPickerMenu.js";
import {
  emptyProjectorState,
  projectEvent,
  type ProjectorState,
} from "./chatbox/projector.js";
import "./chatbox/tool-blocks/bootstrap.js";
import { Sidebar, projectKey } from "./shell/Sidebar.js";
import { SettingsShell } from "./settings/SettingsShell.js";
import { Workspace } from "./workspace/Workspace.js";
import "./styles.css";
import type {
  GuiProjectRef,
  GuiProjectView,
  GuiMemorySettingsView,
  GuiModelProfileView,
  GuiRelayDeviceView,
  GuiRemoteProjectView,
  GuiSnapshot,
} from "../shared/ipc.js";

type ViewMode = "workspace" | "settings";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 278;

const defaultMemorySettings = (): GuiMemorySettingsView => ({
  enabled: true,
  daily: true,
  autoDream: true,
  promoteRoot: true,
});

const projectRef = (project: GuiProjectView): GuiProjectRef =>
  project.source === "local"
    ? { source: "local", projectId: project.projectId }
    : { source: "relay", deviceId: project.deviceId, projectId: project.projectId };

const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

export function App() {
  const [view, setView] = useState<ViewMode>("workspace");
  const [hostState, setHostState] = useState<string>("starting");
  const [hostMessage, setHostMessage] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<GuiProjectView[]>([]);
  const [relayDevices, setRelayDevices] = useState<GuiRelayDeviceView[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [projectorState, setProjectorState] = useState<ProjectorState>(emptyProjectorState());
  const [busy, setBusy] = useState<boolean>(false);
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [modelProfile, setModelProfile] = useState<GuiModelProfileView>({ providers: [], providerModels: [], models: [], roles: { primary: "", standard: "", auxiliary: "" } });
  const [memorySettings, setMemorySettings] = useState<GuiMemorySettingsView>(defaultMemorySettings());
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [pickerAnchor, setPickerAnchor] = useState<{ left: number; top: number } | undefined>(undefined);
  const [showAddRemote, setShowAddRemote] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const currentSessionRef = useRef<string | null>(null);
  const projectorStateRef = useRef<ProjectorState>(emptyProjectorState());
  const pendingEventsRef = useRef<ScorelEvent[]>([]);
  const batcherRef = useRef<ReturnType<typeof createRafBatcher> | null>(null);

  const flushPending = useCallback(() => {
    const queued = pendingEventsRef.current;
    if (queued.length === 0) return;
    pendingEventsRef.current = [];
    let next = projectorStateRef.current;
    for (const event of queued) {
      next = projectEvent(next, event);
    }
    projectorStateRef.current = next;
    setProjectorState(next);
  }, []);

  useEffect(() => {
    batcherRef.current = createRafBatcher(flushPending);
    return () => {
      batcherRef.current?.cancel();
      batcherRef.current = null;
    };
  }, [flushPending]);

  const ingestEvent = useCallback((event: ScorelEvent): void => {
    pendingEventsRef.current.push(event);
    const isTerminal =
      event.type === "message_end" ||
      event.type === "turn_end" ||
      event.type === "assistant_message" ||
      event.type === "tool_result" ||
      event.type === "error";
    if (isTerminal) {
      batcherRef.current?.cancel();
      flushPending();
    } else {
      batcherRef.current?.schedule();
    }
  }, [flushPending]);

  const selectedProject = useMemo(
    () => projects.find((project) => projectKey(project) === selectedProjectKey),
    [projects, selectedProjectKey],
  );

  const selectedSessionTitle = useMemo(() => {
    if (!selectedProjectKey || !selectedSessionId) return undefined;
    const sessions = sessionsByProject[selectedProjectKey] ?? [];
    return sessions.find((session) => session.sessionId === selectedSessionId)?.title;
  }, [sessionsByProject, selectedProjectKey, selectedSessionId]);

  const refreshSnapshot = useCallback(async (): Promise<GuiSnapshot> => {
    const [status, snapshot] = await Promise.all([
      window.scorel.getHostStatus(),
      window.scorel.getSnapshot(),
    ]);
    setHostState(status.state);
    setHostMessage(status.message);
    setProjects(snapshot.projects);
    setRelayDevices(snapshot.relayDevices);
    setSelectedProjectKey((current) => {
      if (current && snapshot.projects.some((project) => projectKey(project) === current)) {
        return current;
      }
      const first = snapshot.projects[0];
      return first ? projectKey(first) : null;
    });
    return snapshot;
  }, []);

  const refreshSessionsForProject = useCallback(
    async (project: GuiProjectView): Promise<SessionSummary[]> => {
      const sessions = await window.scorel.listSessions(projectRef(project));
      setSessionsByProject((current) => ({ ...current, [projectKey(project)]: sessions }));
      return sessions;
    },
    [],
  );

  const loadInitialEvents = useCallback((events: PersistentEvent[]): void => {
    let next = emptyProjectorState();
    for (const event of events) {
      next = projectEvent(next, event);
    }
    projectorStateRef.current = next;
    pendingEventsRef.current = [];
    batcherRef.current?.cancel();
    setProjectorState(next);
  }, []);

  const detachCurrentSession = useCallback(async (): Promise<void> => {
    const previous = currentSessionRef.current;
    if (!previous) return;
    currentSessionRef.current = null;
    try {
      await window.scorel.detachSession(previous);
    } catch {
      /* main may already have torn down */
    }
  }, []);

  const attachToSession = useCallback(
    async (project: GuiProjectView, sessionId: string): Promise<void> => {
      await detachCurrentSession();
      currentSessionRef.current = sessionId;
      try {
        const events = await window.scorel.attachSession(projectRef(project), sessionId);
        loadInitialEvents(events);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [detachCurrentSession, loadInitialEvents],
  );

  // Subscribe once to the global session event stream — we filter by current sessionId.
  useEffect(() => {
    const unsubscribe = window.scorel.onSessionEvent(({ sessionId, event }) => {
      if (sessionId !== currentSessionRef.current) return;
      ingestEvent(event as ScorelEvent);
      if (event.type === "session_title_updated" && selectedProject) {
        void refreshSessionsForProject(selectedProject);
      }
      if (event.type === "message_end" || event.type === "turn_end" || event.type === "assistant_message") {
        setInFlight(false);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [ingestEvent, refreshSessionsForProject, selectedProject]);

  useEffect(() => window.scorel.onOpenSettings(() => {
    setView("settings");
  }), []);

  useEffect(() => {
    void (async () => {
      setBusy(true);
      try {
        const snapshot = await refreshSnapshot();
        if (snapshot.projects[0]) {
          await refreshSessionsForProject(snapshot.projects[0]);
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    const key = projectKey(selectedProject);
    if (sessionsByProject[key]) return;
    void refreshSessionsForProject(selectedProject).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [selectedProject, sessionsByProject, refreshSessionsForProject]);

  useEffect(() => {
    if (!selectedProject) {
      setModelProfile({ providers: [], providerModels: [], models: [], roles: { primary: "", standard: "", auxiliary: "" } });
      setMemorySettings(defaultMemorySettings());
      setSelectedModelId("");
      return;
    }
    void window.scorel.listModels(projectRef(selectedProject))
      .then((profile) => {
        setModelProfile(profile);
        setSelectedModelId((current) => {
          if (current && profile.models.some((model) => model.modelId === current)) return current;
          return profile.roles.standard || profile.models[0]?.modelId || "";
        });
      })
      .catch((cause) => {
        setModelProfile({ providers: [], providerModels: [], models: [], roles: { primary: "", standard: "", auxiliary: "" } });
        setSelectedModelId("");
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    void window.scorel.getMemorySettings(projectRef(selectedProject))
      .then((memory) => {
        setMemorySettings(memory);
      })
      .catch((cause) => {
        setMemorySettings(defaultMemorySettings());
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [selectedProject]);

  const handleProjectClick = useCallback((key: string): void => {
    setSelectedProjectKey(key);
  }, []);

  const handleSessionClick = useCallback(
    (key: string, sessionId: string): void => {
      setSelectedProjectKey(key);
      setSelectedSessionId(sessionId);
      const project = projects.find((candidate) => projectKey(candidate) === key);
      if (!project) return;
      loadInitialEvents([]);
      void attachToSession(project, sessionId);
    },
    [projects, attachToSession, loadInitialEvents],
  );

  const handleAddLocalProject = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const project = await window.scorel.addLocalProject();
      const snapshot = await refreshSnapshot();
      if (project) {
        setSelectedProjectKey(`local:${project.projectId}`);
        const view = snapshot.projects.find((candidate) => projectKey(candidate) === `local:${project.projectId}`);
        if (view) await refreshSessionsForProject(view);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [refreshSnapshot, refreshSessionsForProject]);

  const handleNewSession = useCallback(async (): Promise<void> => {
    await detachCurrentSession();
    const fallbackProject = selectedProject ?? projects[0];
    if (fallbackProject && !selectedProject) {
      setSelectedProjectKey(projectKey(fallbackProject));
    }
    setSelectedSessionId(null);
    setInFlight(false);
    loadInitialEvents([]);
    setError(null);
  }, [detachCurrentSession, loadInitialEvents, projects, selectedProject]);

  const handleSubmitMessage = useCallback(async (): Promise<void> => {
    const targetProject = selectedProject ?? projects[0];
    if (!targetProject) return;
    if (!selectedProject) {
      setSelectedProjectKey(projectKey(targetProject));
    }
    const content = message.trim();
    if (!content) return;
    setMessage("");
    setBusy(true);
    setInFlight(true);
    try {
      let sessionId = selectedSessionId;
      if (!sessionId) {
        sessionId = (await window.scorel.createSession(
          projectRef(targetProject),
          selectedModelId ? { modelId: selectedModelId } : undefined,
        )) as string;
        setSelectedSessionId(sessionId);
        await refreshSessionsForProject(targetProject);
        await attachToSession(targetProject, sessionId);
      }
      await window.scorel.sendMessage(projectRef(targetProject), sessionId as SessionId, content);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInFlight(false);
    } finally {
      setBusy(false);
    }
  }, [
    selectedProject,
    projects,
    selectedSessionId,
    selectedModelId,
    message,
    refreshSessionsForProject,
    attachToSession,
  ]);

  const handleProjectAdded = useCallback((project: GuiRemoteProjectView): void => {
    setSelectedProjectKey(`relay:${project.deviceId}:${project.projectId}`);
  }, []);

  const openProjectPicker = useCallback((anchor: DOMRect): void => {
    const popoverWidth = 324;
    const margin = 12;
    const left = Math.min(
      Math.max(anchor.left, margin),
      Math.max(margin, window.innerWidth - popoverWidth - margin),
    );
    setPickerAnchor({ left, top: anchor.bottom + 6 });
    setPickerOpen(true);
  }, []);

  const handleSidebarResizeStart = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handleMove = (moveEvent: globalThis.MouseEvent): void => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };
    const handleUp = (): void => {
      document.body.classList.remove("sidebar-resizing");
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    document.body.classList.add("sidebar-resizing");
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
  }, [sidebarWidth]);

  const picker = pickerOpen ? (
    <ProjectPickerMenu
      projects={projects}
      selectedKey={selectedProjectKey}
      anchor={pickerAnchor}
      onSelect={handleProjectClick}
      onAddLocal={() => void handleAddLocalProject()}
      onAddRemote={() => setShowAddRemote(true)}
      onClose={() => setPickerOpen(false)}
    />
  ) : null;

  const remoteDialog = showAddRemote ? (
    <AddRemoteProjectDialog
      devices={relayDevices}
      initialDeviceId={relayDevices[0]?.deviceId}
      onClose={() => setShowAddRemote(false)}
      onSubmitted={(project) => {
        handleProjectAdded(project);
        void refreshSnapshot();
      }}
      setError={setError}
    />
  ) : null;

  if (view === "settings") {
    return (
      <SettingsShell
        devices={relayDevices}
        project={selectedProject ? projectRef(selectedProject) : null}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        refresh={async () => {
          await refreshSnapshot();
        }}
        modelProfile={modelProfile}
        memory={memorySettings}
        onModelProfileChange={(profile) => {
          setModelProfile(profile);
          setSelectedModelId((current) => {
            if (current && profile.models.some((model) => model.modelId === current)) return current;
            return profile.roles.standard || profile.models[0]?.modelId || "";
          });
        }}
        onMemoryChange={setMemorySettings}
        onBack={() => setView("workspace")}
      />
    );
  }

  // void hostState reference (status surfaced via topbar message)
  void hostState;

  const shellStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;
  const shellClassName = `app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`;

  return (
    <div className={shellClassName} style={shellStyle}>
      {sidebarCollapsed ? null : (
        <Sidebar
          projects={projects}
          selectedProjectKey={selectedProjectKey}
          selectedSessionId={selectedSessionId}
          relayDevices={relayDevices}
          sessionsByProject={sessionsByProject}
          busy={busy}
          onNewSessionClick={() => void handleNewSession()}
          onProjectPickerOpen={openProjectPicker}
          onProjectClick={handleProjectClick}
          onSessionClick={handleSessionClick}
          onSettingsClick={() => setView("settings")}
          onSidebarToggle={() => setSidebarCollapsed(true)}
          onResizeStart={handleSidebarResizeStart}
        />
      )}
      <Workspace
        selectedProject={selectedProject}
        selectedSessionTitle={selectedSessionTitle}
        hasActiveSession={Boolean(selectedSessionId && projectorState.turns.length > 0)}
        turns={projectorState.turns}
        message={message}
        onMessageChange={setMessage}
        onSubmit={() => void handleSubmitMessage()}
        busy={busy}
        inFlight={inFlight}
        models={modelProfile.models}
        selectedModelId={selectedModelId}
        onModelChange={setSelectedModelId}
        modelPickerDisabled={Boolean(selectedSessionId && projectorState.turns.length > 0)}
        error={error}
        hostMessage={hostMessage}
        onPickerOpen={openProjectPicker}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => setSidebarCollapsed(false)}
        picker={picker}
      />
      {remoteDialog}
    </div>
  );
}
