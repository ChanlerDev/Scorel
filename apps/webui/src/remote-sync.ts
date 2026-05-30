import type { DaemonConnectionIdentity } from "@scorel/client";
import type { SessionSummary } from "@scorel/protocol";

export type RemoteProject = {
  projectKey: string;
  displayName: string;
  remoteLabel: string;
  sessions: SessionSummary[];
};

export type RemoteSyncIndex = {
  remoteId: string;
  projects: RemoteProject[];
};

export const createRemoteSyncIndex = (input: {
  remoteId: string;
  identity: DaemonConnectionIdentity;
  sessions: SessionSummary[];
}): RemoteSyncIndex => {
  const deviceId = input.identity.deviceId ?? "unknown-device";
  const projectSlug = input.identity.projectSlug ?? "remote-project";
  const remoteLabel = input.identity.deviceDisplayName ?? input.identity.deviceId ?? "Remote";

  return {
    remoteId: input.remoteId,
    projects: [
      {
        projectKey: `remote:${deviceId}:${projectSlug}`,
        displayName: projectSlug,
        remoteLabel,
        sessions: [...input.sessions].sort((left, right) => right.updatedAt - left.updatedAt),
      },
    ],
  };
};
