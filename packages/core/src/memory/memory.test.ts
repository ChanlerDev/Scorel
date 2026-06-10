import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendDailyEntry,
  buildMemoryContext,
  createAppendDailyTool,
  mergeMemoryMarkdown,
  renderDailyEntry,
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

  it("formats structured daily entries and merges memory without duplicating entries", () => {
    const entry = renderDailyEntry({
      summary: "实现 agent-owned daily",
      completed: ["新增 AppendDaily 工具"],
      decisions: ["dream 延迟到 idle 后执行"],
    });
    const merged = mergeMemoryMarkdown("# Project Memory\n", "用户希望 memory 自动运行。");

    expect(entry).toContain("Summary: 实现 agent-owned daily");
    expect(entry).toContain("Completed: 新增 AppendDaily 工具");
    expect(entry).toContain("Decisions: dream 延迟到 idle 后执行");
    expect(mergeMemoryMarkdown(merged, "用户希望 memory 自动运行。")).toBe(merged);
  });

  it("exposes AppendDaily as an append-only journal tool", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "scorel-memory-tool-"));
    const tool = createAppendDailyTool({
      homeDir,
      projectId: "prj_test",
      now: () => Date.UTC(2026, 5, 10, 16, 20),
    });

    const result = await tool.execute("call_daily", {
      summary: "完成 memory journal 工具",
      completed: ["AppendDaily 写入 daily"],
      followUps: ["idle dreamer 整合 memory"],
    }, new AbortController().signal, () => undefined);
    const paths = scorelMemoryPaths({
      homeDir,
      projectId: "prj_test",
      now: () => Date.UTC(2026, 5, 10, 16, 20),
    });
    const daily = await readFile(paths.todayDailyPath, "utf8");

    expect(result.content[0]).toMatchObject({ type: "text", text: "Daily appended: 2026-06-10" });
    expect(daily).toContain("Summary: 完成 memory journal 工具");
    expect(daily).toContain("Follow-ups: idle dreamer 整合 memory");
  });

  it("rejects unsafe project ids", () => {
    expect(() => scorelMemoryPaths({ projectId: "../bad" })).toThrow(/projectId/);
  });
});
