import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendDailyEntry,
  buildMemoryContext,
  mergeMemoryMarkdown,
  renderAutomaticDailyEntry,
  renderMemoryHarness,
  scorelMemoryPaths,
} from "./index.js";

describe("memory files", () => {
  it("renders memory context as a harness-ready reminder block", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "scorel-memory-"));
    const context = await buildMemoryContext({
      homeDir,
      projectId: "prj_test",
      now: () => Date.UTC(2026, 5, 10, 12, 0),
    });

    const rendered = renderMemoryHarness(context);

    expect(rendered).toContain("Root MEMORY.md:");
    expect(rendered).toContain("Project MEMORY.md:");
    expect(rendered).toContain("Recent daily (2026-06-09, 2026-06-10):");
    expect(rendered).toContain("verify current code facts");
  });

  it("appends daily entries to a single markdown file", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "scorel-memory-daily-"));
    const result = await appendDailyEntry({
      homeDir,
      projectId: "prj_test",
      now: () => Date.UTC(2026, 5, 10, 15, 42),
      text: "设计：自动 memory 使用 session JSONL 作为证据链。",
    });

    const paths = scorelMemoryPaths({
      homeDir,
      projectId: "prj_test",
      now: () => Date.UTC(2026, 5, 10, 15, 42),
    });
    const daily = await readFile(paths.todayDailyPath, "utf8");

    expect(result.path).toBe(paths.todayDailyPath);
    expect(daily).toContain("# 2026-06-10");
    expect(daily).toContain("- 15:42 设计：自动 memory 使用 session JSONL 作为证据链。");
  });

  it("creates deterministic daily text and merges memory without duplicating entries", () => {
    const entry = renderAutomaticDailyEntry({
      userText: "我们要做自动 memory",
      assistantText: "实现了 memory harness 和 daily",
    });
    const merged = mergeMemoryMarkdown("# Project Memory\n", "用户希望 memory 自动运行。");

    expect(entry).toBe("进展：我们要做自动 memory -> 实现了 memory harness 和 daily");
    expect(mergeMemoryMarkdown(merged, "用户希望 memory 自动运行。")).toBe(merged);
  });

  it("rejects unsafe project ids", () => {
    expect(() => scorelMemoryPaths({ projectId: "../bad" })).toThrow(/projectId/);
  });
});
