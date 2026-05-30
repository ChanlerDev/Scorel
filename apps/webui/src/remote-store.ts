export type RemoteProfile = {
  id: string;
  name: string;
  endpoint: string;
  token: string;
  updatedAt: number;
  lastSelection?: {
    projectKey: string;
    sessionId: string;
  };
};

export type RemoteSessionAnchors = {
  persistentLastSeq: number;
  streamLastSeq: number;
};

type StoreFile = {
  version: 1;
  profiles: RemoteProfile[];
  anchors: Record<string, RemoteSessionAnchors>;
};

export type RemoteProfileStore = {
  listProfiles(): RemoteProfile[];
  saveProfile(input: { id?: string; name: string; endpoint: string; token: string }): RemoteProfile;
  saveSelection(profileId: string, selection: { projectKey: string; sessionId: string }): void;
  saveSessionAnchors(profileId: string, projectKey: string, sessionId: string, anchors: RemoteSessionAnchors): void;
  getSessionAnchors(profileId: string, projectKey: string, sessionId: string): RemoteSessionAnchors | undefined;
};

const storageKey = "scorel.webui.remotes.v1";

export const createRemoteProfileStore = (
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  now: () => number = Date.now,
  createId: () => string = () => crypto.randomUUID(),
): RemoteProfileStore => {
  const read = (): StoreFile => {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return emptyStore();
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return {
        version: 1,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles.filter(isRemoteProfile) : [],
        anchors: parsed.anchors && typeof parsed.anchors === "object" ? parsed.anchors as Record<string, RemoteSessionAnchors> : {},
      };
    } catch {
      return emptyStore();
    }
  };
  const write = (file: StoreFile): void => {
    storage.setItem(storageKey, JSON.stringify(file));
  };

  return {
    listProfiles: () => [...read().profiles].sort((left, right) => right.updatedAt - left.updatedAt),
    saveProfile: (input) => {
      const file = read();
      const profile: RemoteProfile = {
        id: input.id ?? createId(),
        name: input.name.trim() || input.endpoint.trim(),
        endpoint: input.endpoint.trim(),
        token: input.token,
        updatedAt: now(),
        lastSelection: file.profiles.find((candidate) => candidate.id === input.id)?.lastSelection,
      };
      file.profiles = [profile, ...file.profiles.filter((candidate) => candidate.id !== profile.id)];
      write(file);
      return profile;
    },
    saveSelection: (profileId, selection) => {
      const file = read();
      file.profiles = file.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, lastSelection: selection, updatedAt: now() } : profile,
      );
      write(file);
    },
    saveSessionAnchors: (profileId, projectKey, sessionId, anchors) => {
      const file = read();
      file.anchors[anchorKey(profileId, projectKey, sessionId)] = anchors;
      write(file);
    },
    getSessionAnchors: (profileId, projectKey, sessionId) => read().anchors[anchorKey(profileId, projectKey, sessionId)],
  };
};

const emptyStore = (): StoreFile => ({ version: 1, profiles: [], anchors: {} });

const anchorKey = (profileId: string, projectKey: string, sessionId: string): string =>
  `${profileId}::${projectKey}::${sessionId}`;

const isRemoteProfile = (value: unknown): value is RemoteProfile => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<RemoteProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.endpoint === "string" &&
    typeof candidate.token === "string" &&
    typeof candidate.updatedAt === "number"
  );
};
