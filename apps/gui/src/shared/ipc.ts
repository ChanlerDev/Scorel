import type { HostProject } from "@scorel/protocol";

export type GuiHostStatus = {
  state: "starting" | "connected" | "error";
  message?: string;
};

export type GuiApi = {
  getHostStatus(): Promise<GuiHostStatus>;
  listLocalProjects(): Promise<HostProject[]>;
};

export const guiIpcChannels = {
  getHostStatus: "scorel:getHostStatus",
  listLocalProjects: "scorel:listLocalProjects",
} as const;
