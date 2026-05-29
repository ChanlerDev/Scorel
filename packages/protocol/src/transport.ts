import type { ClientId, Seq, SessionId } from "./ids.js";
import type { ClientMessage, DaemonMessage } from "./wire.js";

export type ConnectParams = {
  clientId: ClientId;
  sessionId?: SessionId;
  persistentLastSeq?: Seq;
  streamLastSeq?: Seq;
  lastSeq?: Seq;
};

export type ConnectResult = {
  clientId: ClientId;
  sessionId?: SessionId;
  currentSeq?: Seq;
};

export type RemoteEndpoint = {
  url: string;
  token: string;
};

export type Unsubscribe = () => void;

export interface DaemonTransport {
  connect(params: ConnectParams): Promise<ConnectResult>;
  send(message: ClientMessage): void | Promise<void>;
  onMessage(handler: (message: DaemonMessage) => void): Unsubscribe;
  close(): void;
}
