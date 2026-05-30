import { DaemonClient, WsTransport, type DaemonConnectionIdentity, type WsTransportOptions } from "@scorel/client";
import type { ClientId, SessionId } from "@scorel/protocol";

export type RemoteSessionConnectionInput = {
  url: string;
  token: string;
  sessionId?: SessionId;
  clientId: ClientId;
  createWebSocket?: WsTransportOptions["createWebSocket"];
};

export type RemoteSessionConnection = {
  client: DaemonClient;
  identity: DaemonConnectionIdentity;
};

export const connectToRemoteSession = async (input: RemoteSessionConnectionInput): Promise<RemoteSessionConnection> => {
  const transport = new WsTransport({
    url: input.url,
    token: input.token,
    createWebSocket: input.createWebSocket,
  });
  const client = new DaemonClient(transport, { clientId: input.clientId });

  await client.connect(input.sessionId);

  return {
    client,
    identity: client.connectionIdentity,
  };
};
