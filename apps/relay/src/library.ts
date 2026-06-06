import { protocolPackageName, protocolVersion } from "@scorel/protocol";

import { createConsoleRelayDiagnostics, MemoryRelayDiagnostics } from "./diagnostics.js";
import { RelayPairing } from "./pairing.js";
import { RelayPresence } from "./presence.js";
import { routeEntryToDevice, routeHostToEntry } from "./routing.js";
import { FileRelayStore, type RelayStore } from "./store.js";
import { startRelayServer, type RelayServer } from "./server.js";

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
  type RelayServer,
  type RelayStore,
};
