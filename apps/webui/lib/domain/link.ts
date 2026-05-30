export type LinkValidation = { ok: true; value: string } | { ok: false; reason: string };

export function validateLink(input: string): LinkValidation {
  if (typeof input !== "string") {
    return { ok: false, reason: "link must be a string" };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "link is required" };
  }

  const lower = trimmed.toLowerCase();
  if (!(lower.startsWith("wss://") || lower.startsWith("ws://"))) {
    return { ok: false, reason: "link must start with wss:// or ws://" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "link is not a valid URL" };
  }

  if (!url.hostname || url.hostname.length === 0) {
    return { ok: false, reason: "link must include a hostname" };
  }

  // Lowercase scheme + host. URL already lowercases protocol; ensure host lowercased.
  const scheme = url.protocol.toLowerCase().replace(/:$/, "");
  if (scheme !== "wss" && scheme !== "ws") {
    return { ok: false, reason: "link must use wss:// or ws://" };
  }

  const host = url.hostname.toLowerCase();
  const port = url.port ? `:${url.port}` : "";
  let path = url.pathname || "";
  // Strip a trailing "/" only if path is just "/" or it has trailing "/".
  if (path === "/") {
    path = "";
  } else if (path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }

  const search = url.search || "";
  const value = `${scheme}://${host}${port}${path}${search}`;
  return { ok: true, value };
}

export function normalizeLink(input: string): string {
  const result = validateLink(input);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}
