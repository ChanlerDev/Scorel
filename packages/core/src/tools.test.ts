import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createReadonlyTools, createWriteTools } from "./tools.js";

describe("readonly tools", () => {
  it("read returns bounded file content and metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-tools-"));
    try {
      await writeFile(join(dir, "notes.txt"), "one\ntwo\nthree\n", "utf8");
      const read = createReadonlyTools({ cwd: dir }).find((tool) => tool.name === "read");

      const result = await read?.execute({
        toolCallId: "call_read",
        args: { path: "notes.txt", offset: 2, limit: 1 },
        signal: new AbortController().signal
      });

      expect(result).toMatchObject({
        isError: false,
        content: [{ type: "text", text: "two\n" }],
        details: { path: join(dir, "notes.txt"), offset: 2, limit: 1, truncated: true }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ls, glob, and grep operate inside the configured cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-tools-"));
    try {
      await writeFile(join(dir, "alpha.txt"), "needle\n", "utf8");
      await writeFile(join(dir, "beta.md"), "haystack\n", "utf8");
      const tools = createReadonlyTools({ cwd: dir });
      const run = async (name: string, args: unknown) => {
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) {
          throw new Error(`missing tool ${name}`);
        }
        return tool.execute({ toolCallId: `call_${name}`, args: args as Record<string, unknown>, signal: new AbortController().signal });
      };

      await expect(run("ls", { path: "." })).resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("alpha.txt") }]
      });
      await expect(run("glob", { pattern: "*.txt" })).resolves.toMatchObject({
        content: [{ type: "text", text: "alpha.txt\n" }]
      });
      await expect(run("grep", { pattern: "needle", path: "." })).resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("alpha.txt:1:needle") }]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an error result when a path escapes cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-tools-"));
    try {
      const read = createReadonlyTools({ cwd: dir }).find((tool) => tool.name === "read");

      const result = await read?.execute({
        toolCallId: "call_read",
        args: { path: "../outside.txt" },
        signal: new AbortController().signal
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("outside cwd") }]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("write tools", () => {
  it("write creates files inside cwd and rejects paths outside cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-tools-"));
    try {
      const write = createWriteTools({ cwd: dir }).find((tool) => tool.name === "write");

      const result = await write?.execute({
        toolCallId: "call_write",
        args: { path: "tmp/notes.txt", content: "created\n" },
        signal: new AbortController().signal
      });

      expect(result).toMatchObject({
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("wrote") }],
        details: { path: join(dir, "tmp", "notes.txt"), bytes: 8 }
      });
      await expect(readFile(join(dir, "tmp", "notes.txt"), "utf8")).resolves.toBe("created\n");

      const escape = await write?.execute({
        toolCallId: "call_write_escape",
        args: { path: "../outside.txt", content: "nope" },
        signal: new AbortController().signal
      });

      expect(escape).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("outside cwd") }]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("edit replaces exact text and fails without modifying ambiguous or missing matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-tools-"));
    try {
      const path = join(dir, "notes.txt");
      await writeFile(path, "alpha\nbeta\n", "utf8");
      const edit = createWriteTools({ cwd: dir }).find((tool) => tool.name === "edit");

      const result = await edit?.execute({
        toolCallId: "call_edit",
        args: { path: "notes.txt", oldText: "beta\n", newText: "gamma\n" },
        signal: new AbortController().signal
      });

      expect(result).toMatchObject({
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("edited") }],
        details: { path, replacements: 1 }
      });
      await expect(readFile(path, "utf8")).resolves.toBe("alpha\ngamma\n");

      const missing = await edit?.execute({
        toolCallId: "call_edit_missing",
        args: { path: "notes.txt", oldText: "delta", newText: "epsilon" },
        signal: new AbortController().signal
      });
      expect(missing).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("Exact text not found") }]
      });
      await expect(readFile(path, "utf8")).resolves.toBe("alpha\ngamma\n");

      await writeFile(path, "same\nsame\n", "utf8");
      const ambiguous = await edit?.execute({
        toolCallId: "call_edit_ambiguous",
        args: { path: "notes.txt", oldText: "same\n", newText: "changed\n" },
        signal: new AbortController().signal
      });
      expect(ambiguous).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("matched 2 times") }]
      });
      await expect(readFile(path, "utf8")).resolves.toBe("same\nsame\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bash returns datafied timeout and truncated output errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-tools-"));
    try {
      const bash = createWriteTools({ cwd: dir, bashTimeoutMs: 50, maxBytes: 16 }).find((tool) => tool.name === "bash");

      const timedOut = await bash?.execute({
        toolCallId: "call_bash_timeout",
        args: { command: "sleep 1" },
        signal: new AbortController().signal
      });
      expect(timedOut).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("timed out") }],
        details: { timedOut: true }
      });

      const output = await bash?.execute({
        toolCallId: "call_bash_output",
        args: { command: "printf 'abcdefghijklmnopqrstuvwxyz'" },
        signal: new AbortController().signal
      });
      expect(output).toMatchObject({
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("[truncated]") }],
        details: { truncated: true, timedOut: false }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
