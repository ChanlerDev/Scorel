import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetScopeKeyCacheForTests,
  computeScopeKey,
} from "./scope-key";

describe("computeScopeKey", () => {
  beforeEach(() => {
    __resetScopeKeyCacheForTests();
  });

  it("returns a 24-char lowercase hex string", async () => {
    const key = await computeScopeKey("device_a", "project-alpha");
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(key).toHaveLength(24);
  });

  it("is deterministic for the same input", async () => {
    const key1 = await computeScopeKey("device_a", "project-alpha");
    __resetScopeKeyCacheForTests();
    const key2 = await computeScopeKey("device_a", "project-alpha");
    expect(key1).toBe(key2);
  });

  it("returns different keys for different deviceId", async () => {
    const a = await computeScopeKey("device_a", "project");
    const b = await computeScopeKey("device_b", "project");
    expect(a).not.toBe(b);
  });

  it("returns different keys for different projectSlug", async () => {
    const a = await computeScopeKey("device", "project_a");
    const b = await computeScopeKey("device", "project_b");
    expect(a).not.toBe(b);
  });

  it("memoizes by (deviceId, projectSlug) pair", async () => {
    const p1 = computeScopeKey("device_a", "project-alpha");
    const p2 = computeScopeKey("device_a", "project-alpha");
    expect(p1).toBe(p2);
    await p1;
  });

  it("does not collide between (a, bc) and (ab, c) — separator works", async () => {
    // Only matters if separator is actually byte-distinct. The NUL byte
    // separator must make these inputs hash distinctly.
    const k1 = await computeScopeKey("a", "bc");
    const k2 = await computeScopeKey("ab", "c");
    expect(k1).not.toBe(k2);
  });
});
