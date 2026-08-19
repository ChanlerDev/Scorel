import { describe, expect, it } from "vitest";

import type { ScorelMessage } from "@scorel/protocol";

import {
  AbortError,
  DEFAULT_PROVIDER_RETRY_CONFIG,
  abortableSleep,
  computeRetryDelay,
  getRetryAfterMs,
  isAbortError,
  isRetryableAssistantMessage,
  isRetryableError,
  type ProviderRetryConfig,
} from "./retry.js";

const errorMessage = (text: string): ScorelMessage & { role: "assistant" } => ({
  role: "assistant",
  content: [],
  stopReason: "error",
  meta: { errorMessage: text },
});

const okMessage = (): ScorelMessage & { role: "assistant" } => ({
  role: "assistant",
  content: [{ type: "text", text: "done" }],
  stopReason: "end_turn",
});

describe("isAbortError", () => {
  it("detects AbortError by name", () => {
    const error = new Error("something");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
  });

  it("detects abort by message", () => {
    expect(isAbortError(new Error("Request was aborted"))).toBe(true);
    expect(isAbortError(new Error("This operation was aborted by the user"))).toBe(true);
  });

  it("returns false for non-abort errors", () => {
    expect(isAbortError(new Error("fetch failed"))).toBe(false);
    expect(isAbortError(new Error("429 Too Many Requests"))).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("never retries abort errors", () => {
    const abortError = new Error("Request was aborted");
    expect(isRetryableError(abortError)).toBe(false);
  });

  it.each([
    [429],
    [500],
    [502],
    [503],
    [504],
    [524],
    [408],
    [409],
  ] as const)("retries HTTP %s", (status) => {
    const error = new Error(`HTTP ${status}`);
    (error as { status?: number }).status = status;
    expect(isRetryableError(error)).toBe(true);
  });

  it.each([
    [400],
    [401],
    [403],
    [404],
    [422],
  ] as const)("does not retry HTTP %s", (status) => {
    const error = new Error(`HTTP ${status}`);
    (error as { status?: number }).status = status;
    expect(isRetryableError(error)).toBe(false);
  });

  it("respects x-should-retry: true header", () => {
    const error = new Error("unknown");
    (error as { headers?: Headers }).headers = new Headers({ "x-should-retry": "true" });
    expect(isRetryableError(error)).toBe(true);
  });

  it("respects x-should-retry: false header", () => {
    const error = new Error("unknown");
    (error as { status?: number }).status = 500;
    (error as { headers?: Headers }).headers = new Headers({ "x-should-retry": "false" });
    expect(isRetryableError(error)).toBe(false);
  });

  it.each([
    "fetch failed",
    "ECONNRESET",
    "socket hang up",
    "Connection refused",
    "network error",
    "ETIMEDOUT",
    "Stream ended without finish_reason",
    "stream ended before message_stop",
    "overloaded",
    "Too many requests",
    "Service unavailable",
  ])(`retries network/stream error: "%s"`, (message) => {
    expect(isRetryableError(new Error(message))).toBe(true);
  });

  it.each([
    "insufficient_quota",
    "quota exceeded",
    "billing",
    "GoUsageLimitError",
    "content_filter",
    "content policy violation",
  ])(`does not retry non-retryable error: "%s"`, (message) => {
    expect(isRetryableError(new Error(message))).toBe(false);
  });

  it("retries unknown errors with no status (conservative)", () => {
    expect(isRetryableError(new Error("something unexpected"))).toBe(true);
  });

  it("does not retry unknown HTTP status in non-retryable range", () => {
    const error = new Error("HTTP 451");
    (error as { status?: number }).status = 451;
    expect(isRetryableError(error)).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isRetryableError("fetch failed")).toBe(true);
    expect(isRetryableError(null)).toBe(true);
  });
});

describe("isRetryableAssistantMessage", () => {
  it("retries error messages with retryable patterns", () => {
    expect(isRetryableAssistantMessage(errorMessage("Stream ended without finish_reason"))).toBe(true);
    expect(isRetryableAssistantMessage(errorMessage("429 Too Many Requests"))).toBe(true);
    expect(isRetryableAssistantMessage(errorMessage("overloaded"))).toBe(true);
  });

  it("does not retry error messages with non-retryable patterns", () => {
    expect(isRetryableAssistantMessage(errorMessage("insufficient_quota"))).toBe(false);
    expect(isRetryableAssistantMessage(errorMessage("content_filter"))).toBe(false);
  });

  it("does not retry non-error messages", () => {
    expect(isRetryableAssistantMessage(okMessage())).toBe(false);
  });

  it("does not retry error messages with no errorMessage", () => {
    const msg: ScorelMessage & { role: "assistant" } = {
      role: "assistant",
      content: [],
      stopReason: "error",
      meta: {},
    };
    expect(isRetryableAssistantMessage(msg)).toBe(false);
  });
});

describe("getRetryAfterMs", () => {
  it("extracts retry-after-ms header", () => {
    const error = new Error("429");
    (error as { headers?: Headers }).headers = new Headers({ "retry-after-ms": "5000" });
    expect(getRetryAfterMs(error)).toBe(5000);
  });

  it("extracts retry-after header in seconds", () => {
    const error = new Error("429");
    (error as { headers?: Headers }).headers = new Headers({ "retry-after": "10" });
    expect(getRetryAfterMs(error)).toBe(10_000);
  });

  it("returns undefined when no Retry-After header is present", () => {
    const error = new Error("fetch failed");
    expect(getRetryAfterMs(error)).toBeUndefined();
  });

  it("handles plain object headers (case-insensitive)", () => {
    const error = new Error("429");
    (error as { headers?: Record<string, string> }).headers = { "Retry-After": "5" };
    expect(getRetryAfterMs(error)).toBe(5000);
  });
});

describe("computeRetryDelay", () => {
  const config: ProviderRetryConfig = {
    maxAttempts: 10,
    baseDelayMs: 500,
    maxDelayMs: 30_000,
    jitterFactor: 0.25,
  };

  it("grows exponentially with attempt number", () => {
    // Without jitter, delays would be: 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000...
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt++) {
      // Deterministic test: jitter is random, but we can check bounds
      const delay = computeRetryDelay(attempt, new Error("429"), config);
      delays.push(delay);
    }
    // Each subsequent delay (before cap) should generally be larger
    // With 25% jitter, delay is 75-100% of computed value
    expect(delays[0]).toBeGreaterThanOrEqual(375); // 500 * 0.75
    expect(delays[0]).toBeLessThanOrEqual(500);
    expect(delays[1]).toBeGreaterThanOrEqual(750); // 1000 * 0.75
    expect(delays[1]).toBeLessThanOrEqual(1000);
    expect(delays[6]).toBeLessThanOrEqual(30_000); // capped
  });

  it("caps at maxDelayMs", () => {
    const delay = computeRetryDelay(20, new Error("429"), config);
    expect(delay).toBeLessThanOrEqual(30_000);
  });

  it("uses Retry-After when present", () => {
    const error = new Error("429");
    (error as { headers?: Headers }).headers = new Headers({ "retry-after": "3" });
    const delay = computeRetryDelay(1, error, config);
    // Retry-After is 3000ms, jitter makes it 2250-3000
    expect(delay).toBeGreaterThanOrEqual(2250);
    expect(delay).toBeLessThanOrEqual(3000);
  });

  it("caps Retry-After at maxDelayMs", () => {
    const error = new Error("429");
    (error as { headers?: Headers }).headers = new Headers({ "retry-after": "120" });
    const delay = computeRetryDelay(1, error, config);
    expect(delay).toBeLessThanOrEqual(30_000);
  });

  it("returns non-negative delay", () => {
    const delay = computeRetryDelay(1, new Error("429"), config);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});

describe("abortableSleep", () => {
  it("resolves after the specified duration", async () => {
    const controller = new AbortController();
    const start = Date.now();
    await abortableSleep(50, controller.signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it("rejects immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(1000, controller.signal)).rejects.toBeInstanceOf(AbortError);
  });

  it("rejects when signal fires during sleep", async () => {
    const controller = new AbortController();
    const promise = abortableSleep(5000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toBeInstanceOf(AbortError);
  });
});

describe("DEFAULT_PROVIDER_RETRY_CONFIG", () => {
  it("provides sensible defaults for Codex-style retry", () => {
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.maxAttempts).toBe(10);
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.baseDelayMs).toBe(500);
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.maxDelayMs).toBe(30_000);
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.jitterFactor).toBe(0.25);
  });
});
