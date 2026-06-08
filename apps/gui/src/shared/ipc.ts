import type { HostProject, PersistentEvent, SessionId, SessionSummary } from "@scorel/protocol";

export type GuiHostStatus = {
  state: "starting" | "connected" | "error";
  message?: string;
};

export type GuiApi = {
  getHostStatus(): Promise<GuiHostStatus>;
  listLocalProjects(): Promise<HostProject[]>;
  addLocalProject(): Promise<HostProject | null>;
  listLocalSessions(projectId: string): Promise<SessionSummary[]>;
  createLocalSession(projectId: string): Promise<SessionId>;
  openLocalSession(sessionId: string): Promise<PersistentEvent[]>;
  sendLocalMessage(sessionId: string, content: string): Promise<PersistentEvent[]>;
};

export const guiIpcChannels = {
  getHostStatus: "scorel:getHostStatus",
  listLocalProjects: "scorel:listLocalProjects",
  addLocalProject: "scorel:addLocalProject",
  listLocalSessions: "scorel:listLocalSessions",
  createLocalSession: "scorel:createLocalSession",
  openLocalSession: "scorel:openLocalSession",
  sendLocalMessage: "scorel:sendLocalMessage",
} as const;
