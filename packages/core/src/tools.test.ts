import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createReadonlyTools } from "./tools.js";

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
