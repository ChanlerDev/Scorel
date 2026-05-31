import type { ConnectionErrorReason } from "./state";

// Categorization helper for raw errors surfaced from the daemon transport.
//
// Browser WebSocket has limited error introspection; categorization is
// best-effort. Daemon-supplied error codes win over WebSocket close codes.
//
// Buckets (per S0035 spec):
// - `auth`             ↔ daemon `auth_failed` error code.
// - `network`          ↔ ws close code 1006 OR Node-style network error
//                        message (ENOTFOUND / ECONNREFUSED / ETIMEDOUT).
// - `version_mismatch` ↔ daemon `protocol_mismatch` error code OR
//                        `protocolMismatch === true` flag from the caller.
// - else `unknown`.
//
// Note (S0045 §4.2): the new `transport_disconnected` marker error from
// `@scorel/client` falls through to the `unknown` bucket, which the pool
// does NOT auto-retry. That means a stale-token / dead-socket scenario
// surfaces once, the user sees the error, and they have to manually click
// Reconnect — no infinite retry storm.

export type CategorizeInput = {
  closeCode?: number;
  errorCode?: string;
  message?: string;
  protocolMismatch?: boolean;
};

export type CategorizedError = {
  reason: ConnectionErrorReason;
  message: string;
};

const NETWORK_PATTERN = /(ENOTFOUND|ECONNREFUSED|ETIMEDOUT)/i;

export function categorize(input: CategorizeInput): CategorizedError {
  const message = input.message ?? "Connection failed";

  if (input.errorCode === "auth_failed") {
    return { reason: "auth", message };
  }
  if (input.errorCode === "protocol_mismatch" || input.protocolMismatch === true) {
    return { reason: "version_mismatch", message };
  }
  if (input.closeCode === 1006) {
    return { reason: "network", message };
  }
  if (input.message && NETWORK_PATTERN.test(input.message)) {
    return { reason: "network", message };
  }

  return { reason: "unknown", message };
}
