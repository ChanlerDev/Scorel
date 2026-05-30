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
  const url = normalizeDeviceLink(input.url);
  const transport = new WsTransport({
    url,
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

export const normalizeDeviceLink = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Device Link is required");
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Device Link must be a ws:// or wss:// endpoint");
  }
  return url.toString().replace(/\/$/, "");
};
