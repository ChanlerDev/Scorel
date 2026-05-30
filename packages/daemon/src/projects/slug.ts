import { resolve } from "node:path";

const WINDOWS_DRIVE_PATTERN = /^([A-Za-z]):[/\\](.*)$/;

export type ToProjectSlugOptions = {
  /** Override the cwd used to resolve relative inputs. Defaults to `process.cwd()`. */
  cwd?: string;
};

/**
 * Compute the daemon-owned `projectSlug` for a workspace path.
 *
 * Codebuddy-style rule:
 *   1. Resolve the input to an absolute POSIX-style path.
 *   2. Strip the leading `/`.
 *   3. Replace every remaining `/` with `-`.
 *   4. Filesystem root (`/`) maps to the literal `root`.
 *   5. Empty / non-string input throws.
 *
 * Windows is best-effort: a leading drive letter (`C:` or `C:\`) is stripped,
 * `\` is treated as a path separator, and the rest of the rule applies.
 *
 * Slugs are deterministic, URL-safe, and human-readable. They are never
 * hashed, URL-encoded, or truncated.
 */
export const toProjectSlug = (input: string, options: ToProjectSlugOptions = {}): string => {
  if (typeof input !== "string") {
    throw new TypeError(`toProjectSlug expected a string, got ${typeof input}`);
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("toProjectSlug expected a non-empty path");
  }

  let normalized: string;
  const windowsMatch = WINDOWS_DRIVE_PATTERN.exec(trimmed);
  if (windowsMatch) {
    // Drop drive letter and convert backslashes; treat as absolute POSIX path.
    normalized = `/${windowsMatch[2].replace(/\\+/g, "/")}`;
  } else {
    normalized = options.cwd ? resolve(options.cwd, trimmed) : resolve(trimmed);
    // path.resolve preserves backslashes on POSIX. Normalize for safety.
    normalized = normalized.replace(/\\+/g, "/");
  }

  // Collapse repeated slashes and strip the leading `/`.
  const stripped = normalized.replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (stripped.length === 0) {
    return "root";
  }
  return stripped.replace(/\//g, "-");
};

/**
 * Best-effort reverse of {@link toProjectSlug}. Returns `null` for inputs that
 * obviously cannot have come from `toProjectSlug` (empty, contains `/`,
 * leading/trailing `-`).
 *
 * Note: `-` collisions (`/pi-mono` vs `/pi/mono`) are accepted by the rule, so
 * this reverse is unsuitable for identity. Callers that need an authoritative
 * `workDir` must store it separately (e.g. `workDirHint`).
 */
export const fromProjectSlug = (slug: string): string | null => {
  if (typeof slug !== "string" || slug.length === 0) {
    return null;
  }
  if (slug.includes("/") || slug.startsWith("-") || slug.endsWith("-")) {
    return null;
  }
  if (slug === "root") {
    return "/";
  }
  return `/${slug.replace(/-/g, "/")}`;
};
