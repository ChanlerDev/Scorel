import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCodingTools } from "./coding-tools.js";

const tempRoot = async (): Promise<string> => {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "scorel-tools-"));
};

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string =>
  result.content.find((block) => block.type === "text")?.text ?? "";

const toolByName = (cwd: string, name: string) => {
  const tool = createCodingTools({ cwd }).find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
};

describe("coding tools", () => {
  it("reads files with stable line numbers and line ranges", async () => {
    const cwd = await tempRoot();
    await writeFile(join(cwd, "sample.txt"), "alpha\nbeta\ngamma\n");
    const read = toolByName(cwd, "Read");

    const result = await read.execute("call_read", { path: "sample.txt", offset: 2, limit: 1 }, new AbortController().signal, () => undefined);

    expect(textOf(result)).toBe("     2\tbeta");
    expect(result.details).toMatchObject({ path: join(cwd, "sample.txt"), startLine: 2, endLine: 2, totalLines: 3 });
  });

  it("requires existing files to be read before Write and rejects stale writes", async () => {
    const cwd = await tempRoot();
    const path = join(cwd, "target.txt");
    await writeFile(path, "before\n");
    const tools = createCodingTools({ cwd });
    const read = tools.find((tool) => tool.name === "Read")!;
    const write = tools.find((tool) => tool.name === "Write")!;

    await expect(
      write.execute("call_write", { path: "target.txt", content: "unsafe\n" }, new AbortController().signal, () => undefined),
    ).rejects.toThrow("Read must be used before Write");

    await read.execute("call_read", { path: "target.txt" }, new AbortController().signal, () => undefined);
    await writeFile(path, "external change\n");

    await expect(
      write.execute("call_write", { path: "target.txt", content: "after\n" }, new AbortController().signal, () => undefined),
    ).rejects.toThrow("changed since last Read");
  });

  it("edits exact strings and rejects ambiguous matches", async () => {
    const cwd = await tempRoot();
    const path = join(cwd, "target.txt");
    await writeFile(path, "one\ntwo\none\n");
    const tools = createCodingTools({ cwd });
    const read = tools.find((tool) => tool.name === "Read")!;
    const edit = tools.find((tool) => tool.name === "Edit")!;

    await read.execute("call_read", { path: "target.txt" }, new AbortController().signal, () => undefined);
    await expect(
      edit.execute(
        "call_edit",
        { path: "target.txt", old_string: "one", new_string: "uno" },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow("matched 2 times");

    const result = await edit.execute(
      "call_edit",
      { path: "target.txt", old_string: "two", new_string: "dos" },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("edited");
    await expect(readFile(path, "utf8")).resolves.toBe("one\ndos\none\n");
  });

  it("runs Bash with cwd, timeout, and output truncation", async () => {
    const cwd = await tempRoot();
    await mkdir(join(cwd, "nested"));
    const bash = toolByName(cwd, "Bash");

    const ok = await bash.execute(
      "call_bash",
      { command: "pwd && printf 'abcdef'", cwd: "nested", timeoutMs: 2_000, maxOutputBytes: 4 },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(ok)).toContain("exitCode: 0");
    expect(textOf(ok)).toContain("[stdout truncated");
    expect(await stat(join(cwd, "nested"))).toBeTruthy();

    await expect(
      bash.execute("call_bash", { command: "sleep 2", timeoutMs: 10 }, new AbortController().signal, () => undefined),
    ).rejects.toThrow("timed out");
  });
});
