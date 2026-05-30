import type { DaemonClient, DaemonConnectionIdentity } from "@scorel/client";
import { asClientId, asSessionId, type ClientId, type ScorelEvent, type Seq, type SessionId, type Unsubscribe } from "@scorel/protocol";

import { connectToRemoteSession } from "./connection.js";
import { createEventStreamProjection, type EventStreamRow } from "./event-stream.js";
import { createRemoteSyncIndex, type RemoteSyncIndex } from "./remote-sync.js";
import { createSessionBrowser, type SessionBrowser, type SessionBrowserState } from "./session-browser.js";

export type RemoteSessionInput = {
  url: string;
  token: string;
  sessionId?: string;
  remoteId?: string;
};

export type RemoteSessionState =
  | { status: "disconnected" }
  | { status: "connecting"; sessionId: SessionId | null }
  | {
      status: "connected";
      sessionId: SessionId | null;
      identity: DaemonConnectionIdentity;
      persistentLastSeq: Seq;
      streamLastSeq: Seq;
      resyncMode: "stream_resume" | "persistent_fallback" | "full_reload";
      events: EventStreamRow[];
      syncIndex: RemoteSyncIndex;
      sessionBrowser: SessionBrowserState;
      composer: ComposerState;
    }
  | { status: "error"; message: string };

export type ComposerState = {
  status: "idle" | "sending" | "sent" | "cancelling" | "cancelled" | "error";
  message: string;
};

export type RemoteSessionClient = Pick<
  DaemonClient,
  "sessionId" | "persistentLastSeq" | "streamLastSeq" | "resync" | "listSessions" | "loadSession" | "sendMessage" | "cancel"
> & {
  subscribe(handler: (event: ScorelEvent) => void): Unsubscribe;
};

export type ConnectToRemoteSession = (input: {
  url: string;
  token: string;
  sessionId?: SessionId;
  clientId: ClientId;
}) => Promise<{ client: RemoteSessionClient; identity: DaemonConnectionIdentity }>;

export type RemoteSessionController = {
  connect(input: RemoteSessionInput): Promise<RemoteSessionState>;
  loadSession(sessionId: SessionId): Promise<RemoteSessionState>;
  sendPrompt(content: string): Promise<RemoteSessionState>;
  cancel(): Promise<RemoteSessionState>;
  reconnect(): Promise<RemoteSessionState>;
  getState(): RemoteSessionState;
};

export const createRemoteSessionController = (options?: {
  clientId?: ClientId;
  connect?: ConnectToRemoteSession;
}): RemoteSessionController => {
  const clientId = options?.clientId ?? asClientId(`webui_${crypto.randomUUID()}`);
  const connect = options?.connect ?? connectToRemoteSession;
  let state: RemoteSessionState = { status: "disconnected" };
  let lastInput: RemoteSessionInput | undefined;
  let unsubscribe: Unsubscribe | undefined;
  let sessionBrowser: SessionBrowser | undefined;
  let activeClient: RemoteSessionClient | undefined;

  const runConnect = async (input: RemoteSessionInput): Promise<RemoteSessionState> => {
    lastInput = input;
    const sessionId = input.sessionId?.trim() ? asSessionId(input.sessionId.trim()) : undefined;
    state = { status: "connecting", sessionId: sessionId ?? null };
    try {
      const connection = await connect({
        url: input.url.trim(),
        token: input.token,
        sessionId,
        clientId,
      });
      activeClient = connection.client;
      const projection = createEventStreamProjection();
      const sessions = await connection.client.listSessions();
      const syncIndex = createRemoteSyncIndex({
        remoteId: input.remoteId ?? "remote",
        identity: connection.identity,
        sessions,
      });
      const selectedSessionId = connection.client.sessionId;
      sessionBrowser = createSessionBrowser({
        client: connection.client,
        projectSlug: connection.identity.projectSlug,
        projects: syncIndex.projects,
      });
      const browserState = await sessionBrowser.refresh();
      const selectedBrowserState = selectedSessionId ? await sessionBrowser.load(selectedSessionId) : browserState;
      const resync = selectedSessionId
        ? await connection.client.resync()
        : { mode: "stream_resume" as const, throughSeq: connection.client.streamLastSeq, events: [] };
      for (const event of resync.events) {
        projection.apply(event);
      }
      unsubscribe?.();
      unsubscribe = connection.client.subscribe((event) => {
        projection.apply(event);
        if (state.status === "connected") {
          state = { ...state, events: projection.getRows() };
        }
      });
      state = {
        status: "connected",
        sessionId: connection.client.sessionId,
        identity: connection.identity,
        persistentLastSeq: connection.client.persistentLastSeq,
        streamLastSeq: connection.client.streamLastSeq,
        resyncMode: resync.mode,
        events: projection.getRows(),
        syncIndex,
        sessionBrowser: selectedBrowserState,
        composer: { status: "idle", message: "Ready" },
      };
      return state;
    } catch (error) {
      state = { status: "error", message: redactToken(errorMessage(error), input.token) };
      return state;
    }
  };

  return {
    connect: runConnect,
    loadSession: async (sessionId) => {
      if (!sessionBrowser || state.status !== "connected") {
        state = { status: "error", message: "No connected remote session" };
        return state;
      }
      state = {
        ...state,
        sessionId,
        sessionBrowser: await sessionBrowser.load(sessionId),
      };
      return state;
    },
    sendPrompt: async (content) => {
      const prompt = content.trim();
      if (!activeClient || state.status !== "connected") {
        state = { status: "error", message: "No connected remote session" };
        return state;
      }
      if (!prompt) {
        state = {
          ...state,
          composer: { status: "idle", message: "Prompt is empty" },
        };
        return state;
      }
      state = {
        ...state,
        composer: { status: "sending", message: "Sending prompt..." },
      };
      try {
        await activeClient.sendMessage(prompt);
        if (state.status === "connected") {
          state = {
            ...state,
            composer: { status: "sent", message: "Prompt sent" },
          };
        }
        return state;
      } catch (error) {
        state = {
          ...state,
          composer: { status: "error", message: errorMessage(error) },
        };
        return state;
      }
    },
    cancel: async () => {
      if (!activeClient || state.status !== "connected") {
        state = { status: "error", message: "No connected remote session" };
        return state;
      }
      state = {
        ...state,
        composer: { status: "cancelling", message: "Requesting cancel..." },
      };
      try {
        const result = await activeClient.cancel();
        if (state.status === "connected") {
          state = {
            ...state,
            composer: {
              status: result.cancelled ? "cancelled" : "idle",
              message: result.cancelled ? "Cancel requested" : "No running turn to cancel",
            },
          };
        }
        return state;
      } catch (error) {
        state = {
          ...state,
          composer: { status: "error", message: errorMessage(error) },
        };
        return state;
      }
    },
    reconnect: async () => {
      if (!lastInput) {
        state = { status: "error", message: "No previous remote session connection" };
        return state;
      }
      return runConnect(lastInput);
    },
    getState: () => ({ ...state }),
  };
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Connection failed");

const redactToken = (message: string, token: string): string => {
  if (!token) {
    return message;
  }
  return message.split(token).join("[redacted]");
};
