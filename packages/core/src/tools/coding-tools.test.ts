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

    expect(textOf(result)).toContain("     2\tbeta");
    expect(textOf(result)).toContain("lines 2-2/3");
    expect(result.details).toMatchObject({
      path: join(cwd, "sample.txt"),
      startLine: 2,
      endLine: 2,
      totalLines: 3,
      truncated: true,
      nextOffset: 3,
      canWrite: false,
    });
  });

  it("truncates long default reads but allows writes after partial reads cover the full current file", async () => {
    const cwd = await tempRoot();
    const path = join(cwd, "long.txt");
    await writeFile(path, Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join("\n"));
    const tools = createCodingTools({ cwd, maxReadTokens: 100_000 });
    const read = tools.find((tool) => tool.name === "Read")!;
    const write = tools.find((tool) => tool.name === "Write")!;

    const truncated = await read.execute("call_read", { file_path: "long.txt" }, new AbortController().signal, () => undefined);
    expect(textOf(truncated)).toContain("lines 1-2000/2001");
    expect(truncated.details).toMatchObject({
      startLine: 1,
      endLine: 2000,
      totalLines: 2001,
      truncated: true,
      nextOffset: 2001,
      canWrite: false,
    });
    await expect(
      write.execute("call_write", { file_path: "long.txt", content: "unsafe\n" }, new AbortController().signal, () => undefined),
    ).rejects.toThrow("complete file");

    const rest = await read.execute("call_read", { file_path: "long.txt", offset: 2001, limit: 1 }, new AbortController().signal, () => undefined);
    expect(rest.details).toMatchObject({
      startLine: 2001,
      endLine: 2001,
      totalLines: 2001,
      truncated: false,
      nextOffset: null,
      canWrite: true,
    });
    await write.execute("call_write", { file_path: "long.txt", content: "safe\n" }, new AbortController().signal, () => undefined);
    await expect(readFile(path, "utf8")).resolves.toBe("safe\n");
  });

  it("applies Read token budgets by removing whole lines only", async () => {
    const cwd = await tempRoot();
    await writeFile(join(cwd, "budget.txt"), "12345678\nabcdefg\nlast\n");
    const read = createCodingTools({ cwd, maxReadTokens: 6 }).find((tool) => tool.name === "Read")!;

    const result = await read.execute("call_read", { file_path: "budget.txt" }, new AbortController().signal, () => undefined);

    expect(textOf(result)).toContain("     1\t12345678");
    expect(textOf(result)).not.toContain("abcdefg");
    expect(result.details).toMatchObject({
      startLine: 1,
      endLine: 1,
      totalLines: 3,
      truncated: true,
      nextOffset: 2,
      canWrite: false,
    });
  });

  it("rejects binary and document-like files instead of decoding them as text", async () => {
    const cwd = await tempRoot();
    await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(cwd, "paper.pdf"), "%PDF-1.7\n");
    const read = toolByName(cwd, "Read");

    await expect(
      read.execute("call_read", { file_path: "binary.bin" }, new AbortController().signal, () => undefined),
    ).rejects.toThrow("binary");
    await expect(
      read.execute("call_read", { file_path: "paper.pdf" }, new AbortController().signal, () => undefined),
    ).rejects.toThrow("document");
  });

  it("allows explicit full Read to unlock writes without paginating", async () => {
    const cwd = await tempRoot();
    const path = join(cwd, "full.txt");
    await writeFile(path, Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join("\n"));
    const tools = createCodingTools({ cwd, maxReadTokens: 100_000 });
    const read = tools.find((tool) => tool.name === "Read")!;
    const edit = tools.find((tool) => tool.name === "Edit")!;

    const full = await read.execute("call_read", { file_path: "full.txt", full: true }, new AbortController().signal, () => undefined);
    expect(full.details).toMatchObject({
      startLine: 1,
      endLine: 2001,
      totalLines: 2001,
      truncated: false,
      nextOffset: null,
      canWrite: true,
    });
    await edit.execute(
      "call_edit",
      { file_path: "full.txt", old_string: "line 2001", new_string: "done" },
      new AbortController().signal,
      () => undefined,
    );
    await expect(readFile(path, "utf8")).resolves.toContain("done");
  });

  it("uses a larger token budget for explicit full reads", async () => {
    const cwd = await tempRoot();
    await writeFile(join(cwd, "budget-full.txt"), Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"));
    const read = createCodingTools({ cwd, contextWindow: 1_000 }).find((tool) => tool.name === "Read")!;

    const normal = await read.execute("call_read", { file_path: "budget-full.txt" }, new AbortController().signal, () => undefined);
    const full = await read.execute("call_read", { file_path: "budget-full.txt", full: true }, new AbortController().signal, () => undefined);

    expect(normal.details).toMatchObject({ tokenBudget: 10, truncated: true, canWrite: false });
    expect(full.details).toMatchObject({ tokenBudget: 100, truncated: false, canWrite: true });
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

  it("allows Write to create files and treats fully covered partial reads as writable", async () => {
    const cwd = await tempRoot();
    const tools = createCodingTools({ cwd });
    const read = tools.find((tool) => tool.name === "Read")!;
    const write = tools.find((tool) => tool.name === "Write")!;
    const edit = tools.find((tool) => tool.name === "Edit")!;

    const created = await write.execute(
      "call_write",
      { file_path: "new.txt", content: "hello\n" },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(created)).toContain("File created successfully");
    await expect(readFile(join(cwd, "new.txt"), "utf8")).resolves.toBe("hello\n");

    await read.execute("call_read", { file_path: "new.txt", offset: 1, limit: 1 }, new AbortController().signal, () => undefined);
    await write.execute("call_write", { file_path: "new.txt", content: "covered\n" }, new AbortController().signal, () => undefined);
    await read.execute("call_read", { file_path: "new.txt", offset: 1, limit: 1 }, new AbortController().signal, () => undefined);
    await edit.execute(
      "call_edit",
      { file_path: "new.txt", old_string: "covered", new_string: "hello" },
      new AbortController().signal,
      () => undefined,
    );

    await read.execute("call_read", { file_path: "new.txt" }, new AbortController().signal, () => undefined);
    const updated = await write.execute(
      "call_write",
      { file_path: "new.txt", content: "updated\n" },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(updated)).toContain("updated successfully");
    expect(updated.details).toMatchObject({ type: "update", bytes: 8 });
    expect(updated.details).not.toHaveProperty("originalFile");
    expect(updated.details).not.toHaveProperty("content");
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
    ).rejects.toThrow("Found 2 matches");

    const result = await edit.execute(
      "call_edit",
      { path: "target.txt", old_string: "two", new_string: "dos" },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("updated successfully");
    expect(result.details).toMatchObject({ filePath: path, replacements: 1, replaceAll: false });
    expect(result.details).not.toHaveProperty("oldString");
    expect(result.details).not.toHaveProperty("newString");
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

  it("runs Bash through the configured default shell without rewriting the command", async () => {
    const cwd = await tempRoot();
    const shell = join(cwd, "scorel-shell");
    await writeFile(
      shell,
      [
        "#!/bin/sh",
        "printf 'shell-argv:%s\\n' \"$*\"",
        "if [ \"$1\" = \"-lc\" ]; then shift; exec /bin/sh -c \"$1\"; fi",
        "exec /bin/sh \"$@\"",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const bash = createCodingTools({ cwd, defaultShell: shell }).find((tool) => tool.name === "Bash")!;

    const result = await bash.execute(
      "call_bash",
      { command: "printf 'from-default-shell'", maxOutputBytes: 1_000 },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("shell-argv:-lc printf 'from-default-shell'");
    expect(textOf(result)).toContain("from-default-shell");
    expect(result.details).toMatchObject({
      shell,
    });
  });

  it("uses csh-compatible command flags for csh-like default shells", async () => {
    const cwd = await tempRoot();
    const shell = join(cwd, "csh");
    await writeFile(
      shell,
      [
        "#!/bin/sh",
        "printf 'shell-argv:%s\\n' \"$*\"",
        "if [ \"$1\" = \"-c\" ]; then shift; exec /bin/sh -c \"$1\"; fi",
        "echo unexpected shell args >&2",
        "exit 9",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const bash = createCodingTools({ cwd, defaultShell: shell }).find((tool) => tool.name === "Bash")!;

    const result = await bash.execute(
      "call_bash",
      { command: "printf 'from-csh-compatible-shell'", maxOutputBytes: 1_000 },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("shell-argv:-c printf 'from-csh-compatible-shell'");
    expect(textOf(result)).toContain("from-csh-compatible-shell");
    expect(result.details).toMatchObject({
      shell,
    });
  });

  it("runs Bash through RTK rewrite when token saving is enabled", async () => {
    const cwd = await tempRoot();
    const shell = join(cwd, "scorel-shell");
    await writeFile(
      shell,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"-lc\" ]; then shift; exec /bin/sh -c \"$1\"; fi",
        "exec /bin/sh \"$@\"",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const rtk = join(cwd, "rtk");
    const gainMarker = join(cwd, "rtk-gain-after");
    await writeFile(
      rtk,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"gain\" ] && [ \"$2\" = \"--project\" ] && [ \"$3\" = \"--format\" ] && [ \"$4\" = \"json\" ]; then",
        `  if [ -f '${gainMarker}' ]; then printf '%s\\n' '{\"summary\":{\"total_saved\":124}}'; else printf '%s\\n' '{\"summary\":{\"total_saved\":100}}'; fi`,
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"rewrite\" ] && [ \"$2\" = \"git status\" ]; then echo 'rtk git status'; exit 3; fi",
        "printf 'rtk-argv:%s\\n' \"$*\"",
        `if [ "$1" = "git" ] && [ "$2" = "status" ]; then touch '${gainMarker}'; echo '* main...origin/main [ahead 2]'; echo 'clean — nothing to commit'; exit 0; fi`,
        "exit 9",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const bash = createCodingTools({
      cwd,
      defaultShell: shell,
      tokenSaving: {
        rtk: {
          enabled: true,
          executable: rtk,
        },
      },
    }).find((tool) => tool.name === "Bash")!;

    const result = await bash.execute(
      "call_bash",
      { command: "git status", maxOutputBytes: 1_000 },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("rtk-argv:git status");
    expect(textOf(result)).toContain("* main...origin/main [ahead 2]");
    expect(textOf(result)).toContain("clean — nothing to commit");
    expect(result.details).toMatchObject({
      exitCode: 0,
      shell,
      command: "rtk git status",
      rtk: {
        enabled: true,
        applied: true,
        executable: rtk,
        rewrittenCommand: "rtk git status",
        estimatedSavedTokens: 24,
      },
    });
  });

  it("keeps Bash on the direct shell path when RTK token saving is disabled", async () => {
    const cwd = await tempRoot();
    const bash = createCodingTools({
      cwd,
      tokenSaving: {
        rtk: {
          enabled: false,
          executable: "/missing/rtk",
        },
      },
    }).find((tool) => tool.name === "Bash")!;

    const result = await bash.execute(
      "call_bash",
      { command: "printf 'direct'", maxOutputBytes: 1_000 },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("direct");
    expect(result.details).toMatchObject({
      exitCode: 0,
      rtk: {
        enabled: false,
        applied: false,
      },
    });
  });

  it("finds files with Glob using stable result limits", async () => {
    const cwd = await tempRoot();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "b.ts"), "");
    await writeFile(join(cwd, "src", "a.ts"), "");
    await writeFile(join(cwd, "src", "c.js"), "");
    const glob = toolByName(cwd, "Glob");

    const result = await glob.execute(
      "call_glob",
      { pattern: "src/*.ts", head_limit: 1 },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toBe("src/a.ts");
    expect(result.details).toMatchObject({ filenames: ["src/a.ts"], totalFiles: 2, truncated: true, appliedLimit: 1 });
  });

  it("searches file contents with ripgrep-backed Grep modes and pagination", async () => {
    const cwd = await tempRoot();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "a.ts"), "alpha\nbeta\n");
    await writeFile(join(cwd, "src", "b.ts"), "alphabet\n");
    await writeFile(join(cwd, "src", "c.js"), "alpha\n");
    const grep = toolByName(cwd, "Grep");

    const result = await grep.execute(
      "call_grep",
      { pattern: "alpha", glob: "src/*.ts", output_mode: "content", head_limit: 1 },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toMatch(/src\/[ab]\.ts:1:alpha/);
    expect(textOf(result)).toContain("pagination");
    expect(result.details).toMatchObject({
      mode: "content",
      numLines: 1,
      appliedLimit: 1,
    });

    const files = await grep.execute(
      "call_grep",
      { pattern: "alpha", glob: "src/*.ts", output_mode: "files" },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(files)).toContain("Found 2 files");
    expect(files.details).toMatchObject({ mode: "files", numFiles: 2 });

    await expect(
      grep.execute(
        "call_grep",
        { pattern: "alpha", glob: "src/*.ts", output_mode: "paths" },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow("output_mode must be files, content, or count");

    const count = await grep.execute(
      "call_grep",
      { pattern: "alpha", glob: "src/*.ts", output_mode: "count" },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(count)).toContain("src/a.ts:1");
    expect(count.details).toMatchObject({ mode: "count", numFiles: 2, numMatches: 2 });

    const context = await grep.execute(
      "call_grep",
      { pattern: "beta", glob: "src/a.ts", output_mode: "content", "-B": 1, "-n": true },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(context)).toContain("src/a.ts-1-alpha");
    expect(textOf(context)).toContain("src/a.ts:2:beta");
  });

  it("maintains a TodoWrite list with old/current state and clears all-completed lists", async () => {
    const cwd = await tempRoot();
    const todo = toolByName(cwd, "TodoWrite");

    await expect(
      todo.execute(
        "call_todo",
        {
          todos: [
            { content: "Read file", status: "in_progress", activeForm: "Reading file" },
            { content: "Edit file", status: "in_progress", activeForm: "Editing file" },
          ],
        },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow("at most one in_progress");

    const result = await todo.execute(
      "call_todo",
      {
        todos: [
          { content: "Read file", status: "completed", activeForm: "Reading file" },
          { content: "Edit file", status: "in_progress", activeForm: "Editing file" },
        ],
      },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(result)).toContain("Todos have been modified successfully");
    expect(result.details).toMatchObject({
      oldTodos: [],
      currentTodos: [
        { content: "Read file", status: "completed", activeForm: "Reading file" },
        { content: "Edit file", status: "in_progress", activeForm: "Editing file" },
      ],
    });

    const cleared = await todo.execute(
      "call_todo",
      {
        todos: [
          { content: "Read file", status: "completed", activeForm: "Reading file" },
          { content: "Edit file", status: "completed", activeForm: "Editing file" },
        ],
      },
      new AbortController().signal,
      () => undefined,
    );

    expect(textOf(cleared)).toContain("todo list has been cleared");
    expect(cleared.details).toMatchObject({
      oldTodos: [
        { content: "Read file", status: "completed", activeForm: "Reading file" },
        { content: "Edit file", status: "in_progress", activeForm: "Editing file" },
      ],
      currentTodos: [],
    });
  });
});
