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
  GuiDeviceRef,
  GuiProjectView,
  GuiExtensionSettingsView,
  GuiMemorySettingsView,
  GuiMemoryStatusView,
  GuiModelProfileView,
  GuiRelayDeviceView,
  GuiRemoteProjectView,
  GuiRuntimeSettingsView,
  GuiSnapshot,
  GuiModelSelection,
} from "../shared/ipc.js";

type ViewMode = "workspace" | "settings";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 278;

const defaultMemorySettings = (): GuiMemorySettingsView => ({
  enabled: true,
  daily: true,
  sessionMemory: true,
  autoDream: true,
  promoteRoot: true,
  dreamIdleMinutes: 60,
  autoCompactThreshold: 0.8,
});

const defaultMemoryStatus = (projectId = ""): GuiMemoryStatusView => ({
  projectId: projectId as never,
  dirty: false,
  running: false,
});

const defaultRuntimeSettings = (): GuiRuntimeSettingsView => ({
  tokenSavingRtk: false,
  rtkAvailable: false,
  estimatedOutputTokens: 0,
  estimatedSavedTokens: 0,
});

const defaultModelProfile = (): GuiModelProfileView => ({
  providers: [],
  providerModels: [],
  models: [],
  roles: { primary: "", standard: "", auxiliary: "" },
});

const defaultExtensionSettings = (extensionId: string): GuiExtensionSettingsView => ({
  extensionId,
  enabled: false,
  kind: "im",
  config: {},
  active: false,
});

const projectRef = (project: GuiProjectView): GuiProjectRef =>
  project.source === "local"
    ? { source: "local", projectId: project.projectId }
    : { source: "relay", deviceId: project.deviceId, projectId: project.projectId };

const deviceRef = (deviceKey: string): GuiDeviceRef =>
  deviceKey.startsWith("relay:")
    ? { source: "relay", deviceId: deviceKey.slice("relay:".length) }
    : { source: "local" };

const projectDeviceRef = (project: GuiProjectView | undefined): GuiDeviceRef =>
  !project || project.source === "local"
    ? { source: "local" }
    : { source: "relay", deviceId: project.deviceId };

const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

export const selectedModelValue = (profile: GuiModelProfileView, current: string): string => {
  if (current && profile.models.some((model) => model.modelId === current)) return current;
  if (profile.roles.standard && profile.models.some((model) => model.modelId === profile.roles.standard)) {
    return profile.roles.standard;
  }
  return profile.models[0]?.modelId || "";
};

export const modelSelectionFromValue = (value: string, profile: GuiModelProfileView): GuiModelSelection | undefined => {
  if (!value) return undefined;
  if (profile.models.some((model) => model.modelId === value)) return { modelId: value };
  return undefined;
};

export function App() {
  const [view, setView] = useState<ViewMode>("workspace");
  const [hostState, setHostState] = useState<string>("starting");
  const [hostMessage, setHostMessage] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<GuiProjectView[]>([]);
  const [relayDevices, setRelayDevices] = useState<GuiRelayDeviceView[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [selectedSettingsDeviceKey, setSelectedSettingsDeviceKey] = useState<string>("local");
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [projectorState, setProjectorState] = useState<ProjectorState>(emptyProjectorState());
  const [busy, setBusy] = useState<boolean>(false);
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [modelProfile, setModelProfile] = useState<GuiModelProfileView>(defaultModelProfile());
  const [memorySettings, setMemorySettings] = useState<GuiMemorySettingsView>(defaultMemorySettings());
  const [memoryStatus, setMemoryStatus] = useState<GuiMemoryStatusView>(defaultMemoryStatus());
  const [runtimeSettings, setRuntimeSettings] = useState<GuiRuntimeSettingsView>(defaultRuntimeSettings());
  const [imSettings, setImSettings] = useState<Record<string, GuiExtensionSettingsView>>({
    telegram: defaultExtensionSettings("telegram"),
    qq: defaultExtensionSettings("qq"),
    wechat: defaultExtensionSettings("wechat"),
  });
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
  const sessionsByProjectRef = useRef<Record<string, SessionSummary[]>>({});
  const loadingSessionsRef = useRef<Set<string>>(new Set());
  const settingsLoadSeqRef = useRef(0);

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
  const selectedSettingsDevice = useMemo(() => deviceRef(selectedSettingsDeviceKey), [selectedSettingsDeviceKey]);
  const activeConfigDevice = useMemo(
    () => view === "settings" ? selectedSettingsDevice : projectDeviceRef(selectedProject),
    [selectedProject, selectedSettingsDevice, view],
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

  const ensureSessionsForProject = useCallback(
    (key: string): void => {
      if (sessionsByProjectRef.current[key] !== undefined || loadingSessionsRef.current.has(key)) return;
      const project = projects.find((candidate) => projectKey(candidate) === key);
      if (!project) return;
      loadingSessionsRef.current.add(key);
      void refreshSessionsForProject(project)
        .catch((cause) => {
          setSessionsByProject((current) => ({ ...current, [key]: [] }));
          if (selectedProjectKey === key) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        })
        .finally(() => {
          loadingSessionsRef.current.delete(key);
        });
    },
    [projects, refreshSessionsForProject, selectedProjectKey],
  );

  useEffect(() => {
    sessionsByProjectRef.current = sessionsByProject;
  }, [sessionsByProject]);

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

  useEffect(() => window.scorel.onSessionsChanged((payload) => {
    const key = payload.source === "local"
      ? `local:${payload.projectId}`
      : `relay:${payload.deviceId}:${payload.projectId}`;
    const project = projects.find((candidate) => projectKey(candidate) === key);
    if (!project) return;
    void refreshSessionsForProject(project);
  }), [projects, refreshSessionsForProject]);

  useEffect(() => {
    void (async () => {
      setBusy(true);
      try {
        await refreshSnapshot();
        const [telegram, qq, wechat] = await Promise.all([
          window.scorel.getExtensionSettings("telegram"),
          window.scorel.getExtensionSettings("qq"),
          window.scorel.getExtensionSettings("wechat"),
        ]);
        setImSettings({ telegram, qq, wechat });
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, [refreshSnapshot]);

  useEffect(() => {
    if (selectedProjectKey) ensureSessionsForProject(selectedProjectKey);
  }, [ensureSessionsForProject, selectedProjectKey]);

  useEffect(() => {
    if (view === "settings" && selectedSettingsDevice.source === "relay" && !relayDevices.some((device) => device.deviceId === selectedSettingsDevice.deviceId)) {
      setSelectedSettingsDeviceKey("local");
      return;
    }
    const loadSeq = settingsLoadSeqRef.current + 1;
    settingsLoadSeqRef.current = loadSeq;
    let cancelled = false;
    const isCurrent = (): boolean => !cancelled && settingsLoadSeqRef.current === loadSeq;
    setModelProfile(defaultModelProfile());
    setSelectedModelId("");
    setMemorySettings(defaultMemorySettings());
    setMemoryStatus(defaultMemoryStatus());
    setRuntimeSettings(defaultRuntimeSettings());
    void window.scorel.listModels(activeConfigDevice)
      .then((profile) => {
        if (!isCurrent()) return;
        setModelProfile(profile);
        setSelectedModelId((current) => {
          return selectedModelValue(profile, current);
        });
      })
      .catch((cause) => {
        if (!isCurrent()) return;
        setModelProfile(defaultModelProfile());
        setSelectedModelId("");
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    void window.scorel.getMemorySettings(activeConfigDevice)
      .then((memory) => {
        if (!isCurrent()) return;
        setMemorySettings(memory);
      })
      .catch((cause) => {
        if (!isCurrent()) return;
        setMemorySettings(defaultMemorySettings());
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    void window.scorel.getRuntimeSettings(activeConfigDevice)
      .then((runtime) => {
        if (!isCurrent()) return;
        setRuntimeSettings(runtime);
      })
      .catch((cause) => {
        if (!isCurrent()) return;
        setRuntimeSettings(defaultRuntimeSettings());
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [activeConfigDevice, relayDevices, selectedSettingsDevice, view]);

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
          modelSelectionFromValue(selectedModelId, modelProfile),
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
    modelProfile,
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
        selectedDeviceKey={selectedSettingsDeviceKey}
        onDeviceSelect={setSelectedSettingsDeviceKey}
        device={selectedSettingsDevice}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        refresh={async () => {
          await refreshSnapshot();
        }}
        modelProfile={modelProfile}
        memory={memorySettings}
        memoryStatus={memoryStatus}
        runtime={runtimeSettings}
        imExtensions={imSettings}
        onModelProfileChange={(profile) => {
          setModelProfile(profile);
          setSelectedModelId((current) => {
            return selectedModelValue(profile, current);
          });
        }}
        onMemoryChange={setMemorySettings}
        onRuntimeChange={setRuntimeSettings}
        onExtensionChange={(extension) => setImSettings((current) => ({ ...current, [extension.extensionId]: extension }))}
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
          onProjectExpanded={ensureSessionsForProject}
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
