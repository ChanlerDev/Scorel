import { describe, expect, it } from "vitest";
import { formatFileAccessError, resolveToolPath } from "../../runner/tools/path-utils.js";

describe("runner path utils", () => {
  it("resolves relative paths from the workspace and preserves absolute paths", () => {
    expect(resolveToolPath("notes/todo.md", "/tmp/workspace")).toBe("/tmp/workspace/notes/todo.md");
    expect(resolveToolPath("/tmp/other/file.md", "/tmp/workspace")).toBe("/tmp/other/file.md");
  });

  it("maps file system permission errors to a clear message", () => {
    expect(formatFileAccessError("read", "/tmp/protected.md", { code: "EPERM" })).toBe(
      "Permission denied: /tmp/protected.md",
    );
  });
});
