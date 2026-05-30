import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fromProjectSlug, toProjectSlug } from "./slug.js";

describe("toProjectSlug", () => {
  it("encodes a typical macOS workspace path", () => {
    expect(toProjectSlug("/Users/chanler/personal/Scorel")).toBe(
      "Users-chanler-personal-Scorel",
    );
  });

  it("encodes a typical linux workspace path", () => {
    expect(toProjectSlug("/home/alice/repo")).toBe("home-alice-repo");
  });

  it("maps the filesystem root to `root`", () => {
    expect(toProjectSlug("/")).toBe("root");
  });

  it("collapses repeated leading slashes", () => {
    expect(toProjectSlug("///srv/app")).toBe("srv-app");
  });

  it("normalizes trailing slashes via path.resolve", () => {
    expect(toProjectSlug("/var/data/")).toBe("var-data");
  });

  it("resolves relative paths against the provided cwd fixture", () => {
    const cwd = mkdtempSync(join(tmpdir(), "scorel-slug-"));
    const expected = toProjectSlug(resolve(cwd, "sub/dir"));
    expect(toProjectSlug("sub/dir", { cwd })).toBe(expected);
  });

  it("strips a Windows drive letter as a best-effort fallback", () => {
    expect(toProjectSlug("C:/Users/X/repo")).toBe("Users-X-repo");
  });

  it("throws on an empty string", () => {
    expect(() => toProjectSlug("")).toThrow();
  });

  it("throws on a whitespace-only string", () => {
    expect(() => toProjectSlug("   ")).toThrow();
  });

  it("throws on non-string input", () => {
    // @ts-expect-error invalid input on purpose
    expect(() => toProjectSlug(undefined)).toThrow();
    // @ts-expect-error invalid input on purpose
    expect(() => toProjectSlug(123)).toThrow();
  });

  it("round-trips with fromProjectSlug for clean inputs without `-`", () => {
    const path = "/Users/chanler/personal/Scorel";
    const slug = toProjectSlug(path);
    expect(fromProjectSlug(slug)).toBe(path);
    expect(toProjectSlug(fromProjectSlug(slug)!)).toBe(slug);
  });

  it("round-trips fromProjectSlug for the root slug", () => {
    expect(fromProjectSlug("root")).toBe("/");
    expect(toProjectSlug("/")).toBe("root");
  });
});

describe("fromProjectSlug", () => {
  it("reverses a typical slug to a leading-slash path", () => {
    expect(fromProjectSlug("Users-chanler-personal-Scorel")).toBe(
      "/Users/chanler/personal/Scorel",
    );
  });

  it("returns null on empty input", () => {
    expect(fromProjectSlug("")).toBeNull();
  });

  it("returns null when the slug contains a slash", () => {
    expect(fromProjectSlug("foo/bar")).toBeNull();
  });

  it("returns null on leading or trailing dashes", () => {
    expect(fromProjectSlug("-foo")).toBeNull();
    expect(fromProjectSlug("foo-")).toBeNull();
  });

  it("returns `/` for the `root` sentinel", () => {
    expect(fromProjectSlug("root")).toBe("/");
  });
});
