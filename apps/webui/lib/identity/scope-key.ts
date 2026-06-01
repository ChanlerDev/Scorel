/**
 * Compute the attach-cache scope key for a remote daemon project.
 *
 * Mirrors the CLI rule (see `apps/cli/src/index.ts`):
 *   sha256(kind + "\0" + locator).hex.slice(0, 24)
 *
 * For the WebUI we always use:
 *   kind    = "remote"
 *   locator = `device:<remoteDeviceId>/project:<projectId>`
 *
 * SubtleCrypto is async, so this returns a Promise. Per (deviceId, projectId)
 * the resulting Promise is memoized in a module-scoped Map so callers can
 * await it cheaply on every render.
 */

// NUL byte separator — matches the CLI's `\0` separator byte exactly. Computed
// via `String.fromCharCode(0)` instead of an inline string literal so editors
// and transport layers cannot strip the literal control character from source.
const SEPARATOR = String.fromCharCode(0);

const cache = new Map<string, Promise<string>>();

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += HEX[(byte >> 4) & 0x0f];
    out += HEX[byte & 0x0f];
  }
  return out;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto is not available in this runtime");
  }
  return subtle;
}

async function digest(input: string): Promise<string> {
  const subtle = getSubtle();
  const data = new TextEncoder().encode(input);
  const buffer = await subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(buffer)).slice(0, 24);
}

/**
 * Compute (and cache) the scope key for a remote daemon project. Always
 * resolves to a 24-char lowercase hex string.
 */
export function computeScopeKey(
  remoteDeviceId: string,
  projectId: string,
): Promise<string> {
  // Cache key uses NUL too so a deviceId containing the projectId-prefix
  // can never collide with a sibling.
  const cacheKey = `${remoteDeviceId}${SEPARATOR}${projectId}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const locator = `device:${remoteDeviceId}/project:${projectId}`;
  const promise = digest(`remote${SEPARATOR}${locator}`);
  cache.set(cacheKey, promise);
  // If the digest call rejects, drop the cached promise so the next attempt
  // can retry with a fresh subtle reference.
  promise.catch(() => {
    cache.delete(cacheKey);
  });
  return promise;
}

/** Test seam: clear the memoization cache. Production code should not call this. */
export function __resetScopeKeyCacheForTests(): void {
  cache.clear();
}
