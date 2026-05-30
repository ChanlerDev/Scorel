import { describe, expect, it } from "vitest";
import { normalizeLink, validateLink } from "./link";

describe("validateLink", () => {
  it("accepts wss://host", () => {
    const r = validateLink("wss://host");
    expect(r).toEqual({ ok: true, value: "wss://host" });
  });

  it("accepts wss://host:9876", () => {
    const r = validateLink("wss://host:9876");
    expect(r).toEqual({ ok: true, value: "wss://host:9876" });
  });

  it("accepts ws://localhost:8765", () => {
    const r = validateLink("ws://localhost:8765");
    expect(r).toEqual({ ok: true, value: "ws://localhost:8765" });
  });

  it("lowercases scheme + host and strips trailing slash", () => {
    const r = validateLink("wss://Host/path/");
    expect(r).toEqual({ ok: true, value: "wss://host/path" });
  });

  it("trims whitespace", () => {
    const r = validateLink("   wss://host:9876   ");
    expect(r).toEqual({ ok: true, value: "wss://host:9876" });
  });

  it("normalizes uppercase scheme", () => {
    const r = validateLink("WSS://Host:9876/");
    expect(r).toEqual({ ok: true, value: "wss://host:9876" });
  });

  it("rejects http://", () => {
    const r = validateLink("http://host");
    expect(r.ok).toBe(false);
  });

  it("rejects https://", () => {
    const r = validateLink("https://host");
    expect(r.ok).toBe(false);
  });

  it("rejects empty string", () => {
    const r = validateLink("");
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace-only", () => {
    const r = validateLink("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects wss:", () => {
    const r = validateLink("wss:");
    expect(r.ok).toBe(false);
  });

  it("rejects wss:///", () => {
    const r = validateLink("wss:///");
    expect(r.ok).toBe(false);
  });

  it("rejects plain hostname", () => {
    const r = validateLink("host.com");
    expect(r.ok).toBe(false);
  });
});

describe("normalizeLink", () => {
  it("returns normalized value on success", () => {
    expect(normalizeLink("wss://Host/")).toBe("wss://host");
  });

  it("throws on invalid input", () => {
    expect(() => normalizeLink("http://host")).toThrow();
  });
});
