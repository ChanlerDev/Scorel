// Persistence helper for the empty-state composer's "last active project"
// per device. Stored as a flat `deviceId → projectId` JSON map so each
// device retains its own most-recent picker selection across reloads (S0046).
//
// Boundary policy: the WebUI's `localStorage` rule (see
// `package-boundaries.test.ts`) requires every direct `localStorage`
// reference to live under `lib/store/`. This module is the dedicated
// reader/writer for the picker map; `EmptyComposer` reaches it through the
// exported helpers and never touches `window.localStorage` itself.

const KEY = "scorel.ui.v2.last-active-project";

type LastActiveMap = Record<string, string>;

function read(): LastActiveMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: LastActiveMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function write(next: LastActiveMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota / disabled storage — best-effort UI persistence, swallow.
  }
}

export function readLastActiveProject(
  deviceId: string | undefined,
): string | undefined {
  if (!deviceId) return undefined;
  return read()[deviceId];
}

export function writeLastActiveProject(
  deviceId: string,
  projectId: string,
): void {
  if (!deviceId || !projectId) return;
  const map = read();
  map[deviceId] = projectId;
  write(map);
}
