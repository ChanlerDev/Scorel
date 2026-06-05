import WebSocket from "ws";

import { asRequestId, type ClientId, type DeviceId, type RelayResponse } from "@scorel/protocol";

import { authorizeRelayClient } from "./auth.js";

export type RedeemRelayPairOptions = {
  relayUrl: string;
  pairCode: string;
  deviceId: DeviceId;
  stateDir: string;
  label?: string;
  createWebSocket?: (url: string) => WebSocket;
};

export type RedeemRelayPairResult = {
  clientId: ClientId;
};

export const redeemRelayPair = async (options: RedeemRelayPairOptions): Promise<RedeemRelayPairResult> => {
  const socket = options.createWebSocket?.(options.relayUrl) ?? new WebSocket(options.relayUrl);
  try {
    await waitForOpen(socket);
    socket.send(JSON.stringify({
      type: "host_hello",
      deviceId: options.deviceId,
      label: options.label,
    }));
    socket.send(JSON.stringify({
      type: "redeem_pair",
      requestId: asRequestId("relay_pair"),
      pairCode: options.pairCode,
      deviceId: options.deviceId,
    }));
    const response = await waitForRelayResponse(socket);
    if (!response.ok) {
      throw new Error(`${response.code}: ${response.message}`);
    }
    if (!("clientId" in response.data)) {
      throw new Error("relay pair response missing clientId");
    }
    await authorizeRelayClient({
      stateDir: options.stateDir,
      clientId: response.data.clientId,
    });
    return { clientId: response.data.clientId };
  } finally {
    socket.close();
  }
};

const waitForOpen = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

const waitForRelayResponse = (socket: WebSocket): Promise<RelayResponse> =>
  new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.on("message", function handle(data) {
      const frame = JSON.parse(data.toString()) as RelayResponse | { type?: string };
      if (frame.type !== "relay_response" && frame.type !== "relay_error") {
        return;
      }
      socket.off("message", handle);
      resolve(frame as RelayResponse);
    });
  });
