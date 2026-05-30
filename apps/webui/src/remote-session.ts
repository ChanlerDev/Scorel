import type { DaemonClient, DaemonConnectionIdentity } from "@scorel/client";
import { asClientId, asSessionId, type ClientId, type ScorelEvent, type Seq, type SessionId, type Unsubscribe } from "@scorel/protocol";

import { connectToRemoteSession } from "./connection.js";
import { createEventStreamProjection, type EventStreamRow } from "./event-stream.js";
import { createSessionBrowser, type SessionBrowser, type SessionBrowserState } from "./session-browser.js";

export type RemoteSessionInput = {
  url: string;
  token: string;
  sessionId: string;
};

export type RemoteSessionState =
  | { status: "disconnected" }
  | { status: "connecting"; sessionId: SessionId }
  | {
      status: "connected";
      sessionId: SessionId;
      identity: DaemonConnectionIdentity;
      persistentLastSeq: Seq;
      streamLastSeq: Seq;
      resyncMode: "stream_resume" | "persistent_fallback" | "full_reload";
      events: EventStreamRow[];
      sessionBrowser: SessionBrowserState;
    }
  | { status: "error"; message: string };

export type RemoteSessionClient = Pick<
  DaemonClient,
  "sessionId" | "persistentLastSeq" | "streamLastSeq" | "resync" | "listSessions" | "loadSession"
> & {
  subscribe(handler: (event: ScorelEvent) => void): Unsubscribe;
};

export type ConnectToRemoteSession = (input: {
  url: string;
  token: string;
  sessionId: SessionId;
  clientId: ClientId;
}) => Promise<{ client: RemoteSessionClient; identity: DaemonConnectionIdentity }>;

export type RemoteSessionController = {
  connect(input: RemoteSessionInput): Promise<RemoteSessionState>;
  loadSession(sessionId: SessionId): Promise<RemoteSessionState>;
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

  const runConnect = async (input: RemoteSessionInput): Promise<RemoteSessionState> => {
    lastInput = input;
    const sessionId = asSessionId(input.sessionId.trim());
    state = { status: "connecting", sessionId };
    try {
      const connection = await connect({
        url: input.url.trim(),
        token: input.token,
        sessionId,
        clientId,
      });
      const projection = createEventStreamProjection();
      const resync = await connection.client.resync();
      for (const event of resync.events) {
        projection.apply(event);
      }
      sessionBrowser = createSessionBrowser({
        client: connection.client,
        projectSlug: connection.identity.projectSlug,
      });
      const browserState = await sessionBrowser.refresh();
      const selectedBrowserState =
        connection.client.sessionId !== null ? await sessionBrowser.load(connection.client.sessionId) : browserState;
      unsubscribe?.();
      unsubscribe = connection.client.subscribe((event) => {
        projection.apply(event);
        if (state.status === "connected") {
          state = { ...state, events: projection.getRows() };
        }
      });
      state = {
        status: "connected",
        sessionId: connection.client.sessionId ?? sessionId,
        identity: connection.identity,
        persistentLastSeq: connection.client.persistentLastSeq,
        streamLastSeq: connection.client.streamLastSeq,
        resyncMode: resync.mode,
        events: projection.getRows(),
        sessionBrowser: selectedBrowserState,
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
