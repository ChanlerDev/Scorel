export type Device = {
  id: string;
  name: string;
  link: string;
  token: string;
  createdAt: number;
  lastConnectedAt?: number;
  remoteIdentity?: { deviceId: string; deviceDisplayName?: string };
  projects?: DeviceProject[];
  projectsFetchedAt?: number;
};

export type DeviceProject = {
  projectSlug: string;
  displayName?: string;
  workDirHint?: string;
  sessionCount?: number;
  lastSeenAt?: number;
  sessions?: Record<string, DeviceSessionSummary>;
  sessionsFetchedAt?: number;
};

export type DeviceSessionSummary = {
  sessionId: string;
  title?: string;
  model?: string;
  updatedAt?: number;
  currentSeq?: number;
};
