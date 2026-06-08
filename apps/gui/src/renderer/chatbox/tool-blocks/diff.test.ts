import { describe, expect, it } from "vitest";

import { diffCounts, diffLines } from "./diff.js";

describe("diff helper", () => {
  it("treats identical input as zero changes", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc");
    expect(diffCounts(lines)).toEqual({ added: 0, removed: 0 });
    expect(lines.every((line) => line.kind === "ctx")).toBe(true);
  });

  it("counts inserted and removed lines", () => {
    const lines = diffLines("a\nb\nc", "a\nx\nc");
    expect(diffCounts(lines)).toEqual({ added: 1, removed: 1 });
  });

  it("handles empty old as full add", () => {
    const lines = diffLines("", "alpha\nbeta");
    expect(diffCounts(lines)).toEqual({ added: 2, removed: 1 });
  });
});
