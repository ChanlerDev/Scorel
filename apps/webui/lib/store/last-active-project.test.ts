import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readLastActiveProject,
  writeLastActiveProject,
} from "./last-active-project";

const KEY = "scorel.ui.last-active-project";

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

afterEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("last-active-project store", () => {
  it("returns undefined when storage is empty", () => {
    expect(readLastActiveProject("dev1")).toBeUndefined();
  });

  it("returns undefined when deviceId is undefined", () => {
    writeLastActiveProject("dev1", "alpha");
    expect(readLastActiveProject(undefined)).toBeUndefined();
  });

  it("round-trips a single (deviceId, projectSlug) pair", () => {
    writeLastActiveProject("dev1", "alpha");
    expect(readLastActiveProject("dev1")).toBe("alpha");
  });

  it("preserves entries across distinct devices", () => {
    writeLastActiveProject("dev1", "alpha");
    writeLastActiveProject("dev2", "beta");
    expect(readLastActiveProject("dev1")).toBe("alpha");
    expect(readLastActiveProject("dev2")).toBe("beta");
  });

  it("overwrites the slug for the same device on subsequent writes", () => {
    writeLastActiveProject("dev1", "alpha");
    writeLastActiveProject("dev1", "gamma");
    expect(readLastActiveProject("dev1")).toBe("gamma");
  });

  it("falls back to undefined when the stored JSON is corrupt", () => {
    window.localStorage.setItem(KEY, "{not valid");
    expect(readLastActiveProject("dev1")).toBeUndefined();
  });

  it("ignores non-string values in the stored map", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ dev1: 42, dev2: "alpha" }),
    );
    expect(readLastActiveProject("dev1")).toBeUndefined();
    expect(readLastActiveProject("dev2")).toBe("alpha");
  });

  it("ignores non-object root JSON shapes", () => {
    window.localStorage.setItem(KEY, JSON.stringify("not-an-object"));
    expect(readLastActiveProject("dev1")).toBeUndefined();
  });

  it("ignores empty deviceId or projectSlug on write", () => {
    writeLastActiveProject("", "alpha");
    writeLastActiveProject("dev1", "");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
