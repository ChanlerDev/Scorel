#!/usr/bin/env -S node --import tsx
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createConsoleRelayDiagnostics, FileRelayStore, startRelayServer } from "./library.js";

export * from "./library.js";

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
