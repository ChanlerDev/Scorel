"use client";

import { useState } from "react";
import { asRequestId, type RelayResponse } from "@scorel/protocol";

import { getSharedClientIdentityStore } from "../../lib/store";
import type { DevicesStore } from "../../lib/store/devices";

export function RelayPairingPanel({ store }: { store: DevicesStore }) {
  const [relayUrl, setRelayUrl] = useState("");
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const createPair = async () => {
    setStatus(null);
    const clientId = getSharedClientIdentityStore().getOrCreate();
    const ws = new WebSocket(relayUrl);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "entry_hello", clientId }));
    ws.send(JSON.stringify({
      type: "create_pair_session",
      requestId: asRequestId("webui_pair"),
      clientId,
    }));
    const response = await waitForRelayResponse(ws);
    if (!response.ok || !("pairCode" in response.data)) {
      ws.close();
      throw new Error(response.ok ? "relay did not return a pair code" : response.message);
    }
    setSocket(ws);
    setPairCode(response.data.pairCode);
    setStatus("Pair code created");
  };

  const refreshDevices = async () => {
    if (!socket) return;
    const clientId = getSharedClientIdentityStore().getOrCreate();
    socket.send(JSON.stringify({
      type: "list_authorized_devices",
      requestId: asRequestId("webui_list_devices"),
    }));
    const response = await waitForRelayResponse(socket);
    if (!response.ok || !("devices" in response.data)) {
      throw new Error(response.ok ? "relay did not return devices" : response.message);
    }
    const device = response.data.devices[0];
    if (!device) {
      setStatus("No authorized devices yet");
      return;
    }
    store.addRelayConnector({
      name: device.label ?? device.deviceId,
      relayUrl,
      deviceId: device.deviceId,
      clientId: String(clientId),
    });
    setStatus(`Added ${device.label ?? device.deviceId}`);
  };

  return (
    <section className="space-y-3 rounded-md border border-subtle bg-surface-raised p-4">
      <h2 className="text-sm font-semibold text-text">Relay</h2>
      <div className="flex gap-2">
        <input
          type="text"
          value={relayUrl}
          placeholder="ws://127.0.0.1:8787"
          onChange={(event) => setRelayUrl(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-subtle bg-surface-raised px-3 py-2 text-sm font-mono text-text outline-none transition focus-visible:border-border-strong"
        />
        <button
          type="button"
          onClick={() => {
            void createPair().catch((cause) => setStatus(cause instanceof Error ? cause.message : String(cause)));
          }}
          disabled={!relayUrl}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          Pair
        </button>
      </div>
      {pairCode ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-subtle bg-bg px-3 py-2">
          <code className="text-sm font-semibold text-text">{pairCode}</code>
          <button
            type="button"
            onClick={() => {
              void refreshDevices().catch((cause) => setStatus(cause instanceof Error ? cause.message : String(cause)));
            }}
            className="rounded-md border border-subtle px-3 py-1 text-xs text-muted hover:text-text"
          >
            Refresh
          </button>
        </div>
      ) : null}
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </section>
  );
}

const waitForOpen = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Relay WebSocket connection failed")), { once: true });
  });

const waitForRelayResponse = (socket: WebSocket): Promise<RelayResponse> =>
  new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      const frame = JSON.parse(String(event.data)) as RelayResponse | { type?: string };
      if (frame.type !== "relay_response" && frame.type !== "relay_error") return;
      socket.removeEventListener("message", handler);
      resolve(frame as RelayResponse);
    };
    socket.addEventListener("message", handler);
  });
