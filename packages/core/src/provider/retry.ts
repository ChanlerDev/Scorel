/**
 * Provider-neutral retry policy for the ScorelRuntime provider call chain.
 *
 * Implements Codex-style reliable retry: bounded exponential backoff with jitter,
 * Retry-After header support, correct classification of retryable vs non-retryable
 * errors, and safe retry semantics that never blindly replay after visible output.
 */

import type { ScorelMessage } from "@scorel/protocol";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ProviderRetryConfig = {
  /** Maximum retry attempts (not counting the initial call). */
  maxAttempts: number;
  /** Base delay in ms. Per-attempt delay is `baseDelayMs * 2^(attempt-1)` before jitter. */
  baseDelayMs: number;
  /** Cap on the computed delay after exponential growth and Retry-After. */
  maxDelayMs: number;
  /** Jitter factor (0–1). Final delay is `delay * (1 - Math.random() * jitterFactor)`. */
  jitterFactor: number;
};

/**
 * Default retry configuration: up to 10 retries, short waits early, exponential
 * backoff capped at 30s, 25% jitter.
 *
 * Delay progression (before jitter): 0.5s, 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s.
 */
export const DEFAULT_PROVIDER_RETRY_CONFIG: ProviderRetryConfig = {
  maxAttempts: 10,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterFactor: 0.25,
};

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** Non-retryable error message patterns (quota, billing, content filter, etc.). */
const NON_RETRYABLE_PATTERNS: readonly RegExp[] = [
  /insufficient_quota/i,
  /quota\s+exceeded/i,
  /out\s+of\s+budget/i,
  /billing/i,
  /GoUsageLimitError/i,
  /FreeUsageLimitError/i,
  /Monthly\s+usage\s+limit/i,
  /available\s+balance/i,
  /content_filter/i,
  /content\s+filter/i,
  /content\s+policy/i,
  /safety/i,
];

/** Retryable error message patterns (rate limit, server error, network, stream). */
const RETRYABLE_PATTERNS: readonly RegExp[] = [
  // HTTP status text and codes
  /429/,
  /\b50[0234]\b/,
  /\b5\d\d\b/,
  /too\s+many\s+requests/i,
  /rate\s*limit/i,
  /overloaded/i,
  /service\s+unavailable/i,
  /server\s+error/i,
  /internal\s+error/i,
  // Network / transport
  /fetch\s+failed/i,
  /network\s+error/i,
  /connection\s+(reset|refused|lost|error|closed)/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /EPIPE/i,
  /socket\s+hang\s+up/i,
  /socket\s+(was\s+)?closed/i,
  /other\s+side\s+closed/i,
  /upstream\s+connect/i,
  /reset\s+before\s+headers/i,
  /getaddrinfo/i,
  /timed?\s+out/i,
  /timeout/i,
  /terminated/i,
  // Stream interruptions
  /stream\s+ended/i,
  /ended\s+without/i,
  /stream\s+ended\s+before/i,
  /premature/i,
  /http2?\s+request\s+did\s+not\s+get/i,
  // Provider retry guidance
  /you\s+can\s+retry/i,
  /try\s+your\s+request\s+again/i,
  /please\s+retry/i,
  /ResourceExhausted/i,
];

/** HTTP status codes that are always retryable. */
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 524]);

/** HTTP status codes that are never retryable. */
const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 410, 422, 451]);

/**
 * Extract a numeric HTTP status from an error, if present.
 * Provider SDK errors (OpenAI, Anthropic) carry `.status` as a number.
 */
const getErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
};

/**
 * Extract a Headers-like object from an error, if present.
 * Provider SDK errors carry `.headers` as a `Headers` instance or plain record.
 */
const getErrorHeaders = (error: unknown): Headers | Record<string, string> | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (headers instanceof Headers) return headers;
  if (typeof headers === "object" && headers !== null) {
    return headers as Record<string, string>;
  }
  return undefined;
};

const getHeaderValue = (headers: Headers | Record<string, string> | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  // Case-insensitive lookup for plain record
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
};

/** Returns true if the error is an abort/cancellation (never retryable). */
export const isAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  const message = error.message.toLowerCase();
  return message === "aborted" || message === "request was aborted" || message.includes("this operation was aborted");
};

/** Returns true if the error message matches a non-retryable pattern. */
const matchesNonRetryablePattern = (message: string): boolean =>
  NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(message));

/** Returns true if the error message matches a retryable pattern. */
const matchesRetryablePattern = (message: string): boolean =>
  RETRYABLE_PATTERNS.some((pattern) => pattern.test(message));

/**
 * Classifies whether a thrown error is retryable.
 *
 * Order of checks:
 * 1. Abort → never retryable.
 * 2. `x-should-retry` header → explicit provider guidance.
 * 3. Non-retryable message patterns (quota, billing, content filter) → not retryable.
 * 4. HTTP status code → explicit retryable/non-retryable sets.
 * 5. Retryable message patterns → retryable.
 * 6. Unknown errors with no status and no non-retryable match → retryable (conservative).
 */
export const isRetryableError = (error: unknown): boolean => {
  if (isAbortError(error)) return false;

  const message = error instanceof Error ? error.message : String(error);
  const status = getErrorStatus(error);
  const headers = getErrorHeaders(error);

  // Check x-should-retry header first (explicit provider guidance)
  const shouldRetryHeader = getHeaderValue(headers, "x-should-retry");
  if (shouldRetryHeader === "true") return true;
  if (shouldRetryHeader === "false") return false;

  // Non-retryable message patterns take priority over status
  if (matchesNonRetryablePattern(message)) return false;

  // Explicit HTTP status
  if (status !== undefined) {
    if (RETRYABLE_HTTP_STATUSES.has(status)) return true;
    if (NON_RETRYABLE_HTTP_STATUSES.has(status)) return false;
  }

  // Retryable message patterns
  if (matchesRetryablePattern(message)) return true;

  // Unknown errors: retry conservatively if no status, otherwise respect the status
  if (status === undefined) return true;
  return false;
};

/**
 * Classifies whether an assistant message with `stopReason: "error"` is retryable.
 * Uses the same patterns as {@link isRetryableError} on the message's `errorMessage`.
 */
export const isRetryableAssistantMessage = (message: ScorelMessage & { role: "assistant" }): boolean => {
  if (message.stopReason !== "error") return false;
  const errorMessage = message.meta?.errorMessage;
  if (typeof errorMessage !== "string" || errorMessage.length === 0) return false;
  if (matchesNonRetryablePattern(errorMessage)) return false;
  return matchesRetryablePattern(errorMessage);
};

// ---------------------------------------------------------------------------
// Retry-After extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the Retry-After delay in milliseconds from an error's headers.
 *
 * Supports both `retry-after-ms` (non-standard, used by some providers) and
 * the standard `retry-after` header (seconds or HTTP-date format).
 *
 * Returns `undefined` if no Retry-After header is present.
 */
export const getRetryAfterMs = (error: unknown): number | undefined => {
  const headers = getErrorHeaders(error);

  // retry-after-ms (non-standard but used by some SDK gateways)
  const retryAfterMs = getHeaderValue(headers, "retry-after-ms");
  if (retryAfterMs) {
    const value = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(value) && value >= 0) return value;
  }

  // retry-after (standard HTTP header: seconds or HTTP-date)
  const retryAfter = getHeaderValue(headers, "retry-after");
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
    // Try parsing as HTTP-date
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Backoff computation
// ---------------------------------------------------------------------------

/**
 * Computes the retry delay for a given attempt.
 *
 * 1. If the error carries a Retry-After header, use that (capped at `maxDelayMs`).
 * 2. Otherwise, use exponential backoff: `baseDelayMs * 2^(attempt-1)`.
 * 3. Cap at `maxDelayMs`.
 * 4. Apply jitter: `delay * (1 - Math.random() * jitterFactor)`.
 *
 * @param attempt 1-indexed retry attempt (first retry = 1).
 * @param error The error that triggered the retry (for Retry-After extraction).
 * @param config Retry configuration.
 */
export const computeRetryDelay = (
  attempt: number,
  error: unknown,
  config: ProviderRetryConfig,
): number => {
  const retryAfterMs = getRetryAfterMs(error);
  const rawDelay = retryAfterMs ?? config.baseDelayMs * 2 ** (attempt - 1);
  const cappedDelay = Math.min(rawDelay, config.maxDelayMs);
  const jitter = 1 - Math.random() * config.jitterFactor;
  return Math.max(0, Math.round(cappedDelay * jitter));
};

// ---------------------------------------------------------------------------
// Abortable sleep
// ---------------------------------------------------------------------------

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * If the signal is already aborted or fires during the sleep, the promise
 * rejects with an `AbortError`.
 */
export const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError());
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new AbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Error thrown when an abortable sleep is interrupted by an AbortSignal. */
export class AbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}
