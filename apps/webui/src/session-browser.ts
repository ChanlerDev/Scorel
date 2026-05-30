import type { DaemonClient } from "@scorel/client";
import type { ContentBlock, EventId, PersistentEvent, Seq, SessionId, SessionSummary } from "@scorel/protocol";

import type { RemoteProject } from "./remote-sync.js";

export type SessionBrowserClient = Pick<DaemonClient, "listSessions" | "loadSession">;

export type SessionTreeNode = {
  id: string;
  parentId: string | null;
  depth: number;
  kind: "user" | "assistant" | "tool" | "session";
  title: string;
  text: string;
  seq: Seq;
  isActiveLeaf: boolean;
};

export type SessionBrowserState = {
  projectSlug: string;
  projects: RemoteProject[];
  selectedProjectKey: string | null;
  sessions: SessionSummary[];
  selectedSessionId: SessionId | null;
  tree: SessionTreeNode[];
};

export type SessionBrowser = {
  refresh(): Promise<SessionBrowserState>;
  load(sessionId: SessionId): Promise<SessionBrowserState>;
  getState(): SessionBrowserState;
};

export const createSessionBrowser = (options: {
  client: SessionBrowserClient;
  projectSlug?: string;
  projects?: RemoteProject[];
}): SessionBrowser => {
  let state: SessionBrowserState = {
    projectSlug: options.projectSlug ?? "Remote daemon",
    projects: options.projects ?? [],
    selectedProjectKey: options.projects?.[0]?.projectKey ?? null,
    sessions: [],
    selectedSessionId: null,
    tree: [],
  };

  return {
    refresh: async () => {
      state = {
        ...state,
        sessions: await options.client.listSessions(),
      };
      return copyState(state);
    },
    load: async (sessionId) => {
      const loaded = await options.client.loadSession(sessionId);
      state = {
        ...state,
        selectedSessionId: loaded.sessionId,
        tree: projectSessionTree(loaded.events, loaded.activeLeafId),
      };
      return copyState(state);
    },
    getState: () => copyState(state),
  };
};

export const projectSessionTree = (
  events: PersistentEvent[],
  activeLeafId: EventId | null,
): SessionTreeNode[] => {
  const byId = new Map(events.map((event) => [String(event.id), event]));

  return events.map((event) => ({
    id: String(event.id),
    parentId: event.parentId ? String(event.parentId) : null,
    depth: depthFor(event, byId),
    kind: treeKind(event),
    title: treeTitle(event),
    text: "message" in event ? contentText(event.message.content) : "Session header",
    seq: event.seq,
    isActiveLeaf: activeLeafId === event.id,
  }));
};

export const renderSessionBrowser = (state: SessionBrowserState): { sessions: string; tree: string } => ({
  sessions: renderProjectSessionList(state),
  tree: renderSessionTree(state.tree),
});

export const renderProjectList = (projects: RemoteProject[], selectedProjectKey: string | null): string => {
  if (projects.length === 0) {
    return `<li class="nav-row nav-row-empty"><span class="glyph">-</span><span>No remote connected</span><span class="badge">0</span></li>`;
  }

  return projects
    .map((project) => `
      <li>
        <button class="nav-row project-button${project.projectKey === selectedProjectKey ? " is-active" : ""}" type="button" data-project-key="${escapeHtml(project.projectKey)}">
          <span class="glyph">${escapeHtml(project.displayName.slice(0, 1).toUpperCase())}</span>
          <span>${escapeHtml(project.displayName)}</span>
          <span class="badge">${project.sessions.length}</span>
        </button>
      </li>
    `)
    .join("");
};

const renderProjectSessionList = (state: SessionBrowserState): string => {
  if (state.projects.length > 0) {
    const project = state.projects.find((candidate) => candidate.projectKey === state.selectedProjectKey) ?? state.projects[0];
    return renderSessionList({
      ...state,
      sessions: project?.sessions ?? [],
    });
  }
  return renderSessionList(state);
};

const renderSessionList = (state: SessionBrowserState): string => {
  if (state.sessions.length === 0) {
    return `<li class="nav-row nav-row-empty"><span class="glyph">-</span><span>No sessions synced</span><span class="badge">0</span></li>`;
  }

  return state.sessions
    .map((session, index) => {
      const title = session.title ?? session.sessionId;
      const active = session.sessionId === state.selectedSessionId ? " is-active" : "";
      return `
        <li>
          <button class="nav-row session-button${active}" type="button" data-session-id="${escapeHtml(session.sessionId)}">
            <span class="glyph">${index + 1}</span>
            <span>${escapeHtml(title)}</span>
            <span class="badge">seq ${escapeHtml(String(session.currentSeq))}</span>
          </button>
        </li>
      `;
    })
    .join("");
};

const renderSessionTree = (tree: SessionTreeNode[]): string => {
  if (tree.length === 0) {
    return `
      <article class="event-card session-tree-empty">
        <p class="event-kicker">Session tree</p>
        <h3>No session loaded</h3>
        <p>Select a session from the sidebar to inspect its persistent event tree.</p>
      </article>
    `;
  }

  return `
    <article class="session-tree-card">
      <p class="event-kicker">Session tree</p>
      <ol class="session-tree-list">
        ${tree
          .map(
            (node) => `
              <li class="session-tree-node${node.isActiveLeaf ? " is-active" : ""}" data-tree-node-id="${escapeHtml(node.id)}" style="--depth: ${node.depth}">
                <span class="tree-node-title">${escapeHtml(node.title)} · seq ${escapeHtml(String(node.seq))}</span>
                <span class="tree-node-text">${escapeHtml(node.text)}</span>
                ${node.isActiveLeaf ? '<span class="tree-node-badge">active leaf</span>' : ""}
              </li>
            `,
          )
          .join("")}
      </ol>
    </article>
  `;
};

const depthFor = (event: PersistentEvent, byId: Map<string, PersistentEvent>): number => {
  let depth = 0;
  let parentId = event.parentId ? String(event.parentId) : null;
  while (parentId && byId.has(parentId)) {
    depth += 1;
    parentId = byId.get(parentId)?.parentId ? String(byId.get(parentId)?.parentId) : null;
  }
  return depth;
};

const treeKind = (event: PersistentEvent): SessionTreeNode["kind"] => {
  switch (event.type) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    case "tool_result":
      return "tool";
    case "session_header":
      return "session";
  }
};

const treeTitle = (event: PersistentEvent): string => {
  switch (event.type) {
    case "user_message":
      return "User";
    case "assistant_message":
      return "Assistant";
    case "tool_result":
      return "Tool result";
    case "session_header":
      return "Session";
  }
};

const contentText = (blocks: ContentBlock[]): string =>
  blocks
    .map((block) => {
      switch (block.type) {
        case "text":
        case "thinking":
          return block.text;
        case "tool_call":
          return `${block.toolName} ${JSON.stringify(block.args)}`;
        case "tool_result":
          return typeof block.result === "string" ? block.result : JSON.stringify(block.result);
      }
    })
    .join("");

const copyState = (state: SessionBrowserState): SessionBrowserState => ({
  ...state,
  projects: state.projects.map((project) => ({ ...project, sessions: [...project.sessions] })),
  sessions: [...state.sessions],
  tree: [...state.tree],
});

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
