#!/usr/bin/env -S node --import tsx
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { protocolPackageName, protocolVersion } from "@scorel/protocol";

import { createConsoleRelayDiagnostics, MemoryRelayDiagnostics } from "./diagnostics.js";
import { RelayPairing } from "./pairing.js";
import { RelayPresence } from "./presence.js";
import { routeEntryToDevice, routeHostToEntry } from "./routing.js";
import { FileRelayStore, type RelayStore } from "./store.js";
import { startRelayServer } from "./server.js";

export const relayPackageName = "@scorel/relay" as const;
export const relayProtocolDependency = protocolPackageName;
export const relayProtocolVersion = protocolVersion;

export {
  createConsoleRelayDiagnostics,
  FileRelayStore,
  MemoryRelayDiagnostics,
  RelayPairing,
  RelayPresence,
  routeEntryToDevice,
  routeHostToEntry,
  startRelayServer,
  type RelayStore,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.SCOREL_RELAY_PORT ?? 8787);
  const host = process.env.SCOREL_RELAY_HOST ?? "127.0.0.1";
  const dataDir = process.env.SCOREL_RELAY_DATA_DIR ?? join(homedir(), ".scorel", "relay");
  const server = await startRelayServer({
    host,
    port,
    store: new FileRelayStore({ dataDir }),
    diagnostics: createConsoleRelayDiagnostics(),
  });
  console.log(`scorel relay listening on ${server.url}`);
}
