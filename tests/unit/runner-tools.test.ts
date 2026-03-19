import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { bashTool } from "../../runner/tools/bash.js";
import { readFileTool } from "../../runner/tools/read-file.js";
import { writeFileTool } from "../../runner/tools/write-file.js";
import { editFileTool } from "../../runner/tools/edit-file.js";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = path.join(os.tmpdir(), `scorel-test-${Date.now()}`);
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("read_file tool", () => {
  it("reads a text file", async () => {
    writeFileSync(path.join(workspaceRoot, "hello.txt"), "Hello\nWorld\n");
    const result = await readFileTool({ path: "hello.txt" }, workspaceRoot, signal());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
  });

  it("reads with offset and limit", async () => {
    writeFileSync(path.join(workspaceRoot, "lines.txt"), "a\nb\nc\nd\ne\n");
    const result = await readFileTool({ path: "lines.txt", offset: 1, limit: 2 }, workspaceRoot, signal());
    expect(result.isError).toBe(false);
    expect(result.content).toBe("b\nc");
  });

  it("rejects path escape", async () => {
    const result = await readFileTool({ path: "../../etc/passwd" }, workspaceRoot, signal());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Path escapes workspace root");
  });

  it("returns error for missing file", async () => {
    const result = await readFileTool({ path: "nope.txt" }, workspaceRoot, signal());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("File not found");
  });

  it("detects binary files", async () => {
    const buf = Buffer.alloc(100);
    buf[50] = 0; // null byte
    writeFileSync(path.join(workspaceRoot, "bin.dat"), buf);
    const result = await readFileTool({ path: "bin.dat" }, workspaceRoot, signal());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Binary file detected");
  });
});

describe("write_file tool", () => {
  it("writes a file", async () => {
    const result = await writeFileTool(
      { path: "out.txt", content: "hello" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(false);
    expect(readFileSync(path.join(workspaceRoot, "out.txt"), "utf-8")).toBe("hello");
  });

  it("creates parent directories", async () => {
    const result = await writeFileTool(
      { path: "sub/dir/file.txt", content: "nested" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(false);
    expect(existsSync(path.join(workspaceRoot, "sub/dir/file.txt"))).toBe(true);
  });

  it("rejects path escape", async () => {
    const result = await writeFileTool(
      { path: "../escape.txt", content: "bad" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Path escapes workspace root");
  });
});

describe("edit_file tool", () => {
  it("replaces unique match", async () => {
    writeFileSync(path.join(workspaceRoot, "edit.txt"), "foo bar baz");
    const result = await editFileTool(
      { path: "edit.txt", old_string: "bar", new_string: "qux" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(false);
    expect(readFileSync(path.join(workspaceRoot, "edit.txt"), "utf-8")).toBe("foo qux baz");
  });

  it("errors on no match", async () => {
    writeFileSync(path.join(workspaceRoot, "edit.txt"), "foo bar baz");
    const result = await editFileTool(
      { path: "edit.txt", old_string: "xyz", new_string: "abc" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("No match found");
  });

  it("errors on multiple matches", async () => {
    writeFileSync(path.join(workspaceRoot, "edit.txt"), "aaa bbb aaa");
    const result = await editFileTool(
      { path: "edit.txt", old_string: "aaa", new_string: "ccc" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Multiple matches found (2)");
  });

  it("rejects path escape", async () => {
    const result = await editFileTool(
      { path: "../../etc/hosts", old_string: "a", new_string: "b" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Path escapes workspace root");
  });
});

describe("bash tool", () => {
  it("executes a simple command", async () => {
    const result = await bashTool({ command: "echo hello" }, workspaceRoot, signal());
    expect(result.isError).toBe(false);
    expect(result.content.trim()).toBe("hello");
    expect((result.details as { exitCode: number }).exitCode).toBe(0);
  });

  it("captures non-zero exit code", async () => {
    const result = await bashTool({ command: "exit 42" }, workspaceRoot, signal());
    expect(result.isError).toBe(false); // non-zero is informational
    expect((result.details as { exitCode: number }).exitCode).toBe(42);
  });

  it("respects abort signal", async () => {
    const ac = new AbortController();
    const promise = bashTool({ command: "sleep 60" }, workspaceRoot, ac.signal);
    setTimeout(() => ac.abort(), 50);
    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.content).toContain("aborted");
  });

  it("truncates large output", async () => {
    // Generate output > 32000 chars
    const result = await bashTool(
      { command: "python3 -c \"print('x' * 50000)\"" },
      workspaceRoot,
      signal(),
    );
    expect(result.isError).toBe(false);
    expect((result.details as { truncated: boolean }).truncated).toBe(true);
    expect(result.content.length).toBeLessThan(50000);
    expect(result.content).toContain("truncated");
  });
});
