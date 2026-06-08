import type { PersistentEvent, ScorelEvent, SessionId, SessionSummary } from "@scorel/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createRafBatcher } from "./chatbox/delta-batch.js";
import {
  emptyProjectorState,
  projectEvent,
  type ProjectorState,
} from "./chatbox/projector.js";
import "./chatbox/tool-blocks/bootstrap.js";
import { Sidebar, projectKey } from "./shell/Sidebar.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { Workspace } from "./workspace/Workspace.js";
import "./styles.css";
import type {
  GuiProjectRef,
  GuiProjectView,
  GuiRelayDeviceView,
  GuiRemoteProjectView,
  GuiSnapshot,
} from "../shared/ipc.js";

type ViewMode = "workspace" | "settings";

const projectRef = (project: GuiProjectView): GuiProjectRef =>
  project.source === "local"
    ? { source: "local", projectId: project.projectId }
    : { source: "relay", deviceId: project.deviceId, projectId: project.projectId };

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

  const attachUnsubRef = useRef<(() => void) | null>(null);
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
    attachUnsubRef.current?.();
    attachUnsubRef.current = null;
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
      if (event.type === "message_end" || event.type === "turn_end" || event.type === "assistant_message") {
        setInFlight(false);
      }
    });
    attachUnsubRef.current = unsubscribe;
    return () => {
      unsubscribe();
      attachUnsubRef.current = null;
    };
  }, [ingestEvent]);

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
    if (!selectedProject) return;
    setBusy(true);
    try {
      const sessionId = await window.scorel.createSession(projectRef(selectedProject));
      await refreshSessionsForProject(selectedProject);
      setSelectedSessionId(sessionId as string);
      loadInitialEvents([]);
      await attachToSession(selectedProject, sessionId as string);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [selectedProject, refreshSessionsForProject, attachToSession, loadInitialEvents]);

  const handleSubmitMessage = useCallback(async (): Promise<void> => {
    if (!selectedProject) return;
    const content = message.trim();
    if (!content) return;
    setMessage("");
    setBusy(true);
    setInFlight(true);
    try {
      let sessionId = selectedSessionId;
      if (!sessionId) {
        sessionId = (await window.scorel.createSession(projectRef(selectedProject))) as string;
        setSelectedSessionId(sessionId);
        await refreshSessionsForProject(selectedProject);
        await attachToSession(selectedProject, sessionId);
      }
      await window.scorel.sendMessage(projectRef(selectedProject), sessionId as SessionId, content);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInFlight(false);
    } finally {
      setBusy(false);
    }
  }, [
    selectedProject,
    selectedSessionId,
    message,
    refreshSessionsForProject,
    attachToSession,
  ]);

  const handleProjectAdded = useCallback((project: GuiRemoteProjectView): void => {
    setSelectedProjectKey(`relay:${project.deviceId}:${project.projectId}`);
  }, []);

  if (view === "settings") {
    return (
      <div className="app-shell">
        <Sidebar
          projects={projects}
          selectedProjectKey={selectedProjectKey}
          selectedSessionId={selectedSessionId}
          relayDevices={relayDevices}
          sessionsByProject={sessionsByProject}
          busy={busy}
          onNewSessionClick={() => void handleNewSession()}
          onAddLocalProject={() => void handleAddLocalProject()}
          onProjectClick={handleProjectClick}
          onSessionClick={handleSessionClick}
          onSettingsClick={() => setView("workspace")}
        />
        <SettingsPage
          devices={relayDevices}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          refresh={async () => {
            await refreshSnapshot();
          }}
          onBack={() => setView("workspace")}
        />
      </div>
    );
  }

  // void hostState reference (status surfaced via topbar message)
  void hostState;

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        selectedProjectKey={selectedProjectKey}
        selectedSessionId={selectedSessionId}
        relayDevices={relayDevices}
        sessionsByProject={sessionsByProject}
        busy={busy}
        onNewSessionClick={() => void handleNewSession()}
        onAddLocalProject={() => void handleAddLocalProject()}
        onProjectClick={handleProjectClick}
        onSessionClick={handleSessionClick}
        onSettingsClick={() => setView("settings")}
      />
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
        error={error}
        hostMessage={hostMessage}
        projects={projects}
        selectedProjectKey={selectedProjectKey}
        relayDevices={relayDevices}
        onSelectProject={handleProjectClick}
        onAddLocalProject={() => void handleAddLocalProject()}
        onProjectAdded={handleProjectAdded}
        setError={setError}
        refreshSnapshot={refreshSnapshot}
      />
    </div>
  );
}
