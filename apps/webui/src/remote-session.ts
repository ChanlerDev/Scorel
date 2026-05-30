import type { DaemonClient, DaemonConnectionIdentity } from "@scorel/client";
import { asClientId, asSessionId, type ClientId, type Seq, type SessionId } from "@scorel/protocol";

import { connectToRemoteSession } from "./connection.js";

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
    }
  | { status: "error"; message: string };

export type RemoteSessionClient = Pick<DaemonClient, "sessionId" | "persistentLastSeq" | "streamLastSeq" | "resync">;

export type ConnectToRemoteSession = (input: {
  url: string;
  token: string;
  sessionId: SessionId;
  clientId: ClientId;
}) => Promise<{ client: RemoteSessionClient; identity: DaemonConnectionIdentity }>;

export type RemoteSessionController = {
  connect(input: RemoteSessionInput): Promise<RemoteSessionState>;
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
      const resync = await connection.client.resync();
      state = {
        status: "connected",
        sessionId: connection.client.sessionId ?? sessionId,
        identity: connection.identity,
        persistentLastSeq: connection.client.persistentLastSeq,
        streamLastSeq: connection.client.streamLastSeq,
        resyncMode: resync.mode,
      };
      return state;
    } catch (error) {
      state = { status: "error", message: redactToken(errorMessage(error), input.token) };
      return state;
    }
  };

  return {
    connect: runConnect,
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
