export type RelayDiagnosticEvent = {
  type: string;
  ts: number;
  data: Record<string, unknown>;
};

export type RelayDiagnostics = {
  record(type: string, data?: Record<string, unknown>): void;
};

export class MemoryRelayDiagnostics implements RelayDiagnostics {
  readonly events: RelayDiagnosticEvent[] = [];
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  record(type: string, data: Record<string, unknown> = {}): void {
    this.events.push({ type, ts: this.#now(), data: sanitizeDiagnosticData(data) });
  }
}

export const createConsoleRelayDiagnostics = (): RelayDiagnostics => ({
  record(type, data = {}) {
    // Payload bodies are intentionally excluded by callers; this guard keeps
    // diagnostics useful if a future caller passes a full frame by mistake.
    console.log(JSON.stringify({ type, ts: Date.now(), data: sanitizeDiagnosticData(data) }));
  },
});

const forbiddenKeys = new Set(["payload", "content", "message", "prompt", "result", "data"]);

const sanitizeDiagnosticData = (input: Record<string, unknown>): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = forbiddenKeys.has(key) ? "[redacted]" : value;
  }
  return output;
};
