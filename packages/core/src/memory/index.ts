import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { defineTool, type AgentTool } from "../tools/index.js";

export type MemoryPaths = {
  rootDir: string;
  rootMemoryPath: string;
  projectDir: string;
  projectMemoryPath: string;
  dailyDir: string;
  todayDailyPath: string;
  yesterdayDailyPath: string;
  dreamStatePath: string;
  today: string;
  yesterday: string;
};

export type MemoryContext = {
  paths: MemoryPaths;
  rootMemory: string;
  projectMemory: string;
  todayDaily: string;
  yesterdayDaily: string;
};

export type SessionMemoryPaths = {
  sessionsDir: string;
  sessionMemoryPath: string;
};

export type BuildMemoryContextOptions = {
  projectId: string;
  homeDir?: string;
  now?: () => number;
};

export type AppendDailyOptions = BuildMemoryContextOptions & {
  text: string;
};

export type AppendDailyInput = {
  summary: string;
  completed?: string[];
  decisions?: string[];
  followUps?: string[];
  memoryCandidates?: string[];
};

export type CreateAppendDailyToolOptions = BuildMemoryContextOptions & {
  onAppend?: (result: { path: string; entry: string; date: string }) => void | Promise<void>;
};

export type SessionMemoryInput = {
  sessionId: string;
  projectId: string;
  summary: string;
  recentMessages?: string[];
  decisions?: string[];
  followUps?: string[];
  now?: () => number;
  homeDir?: string;
};

export const memoryDate = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

export const scorelMemoryPaths = (options: BuildMemoryContextOptions): MemoryPaths => {
  const home = options.homeDir ?? homedir();
  const now = options.now ?? Date.now;
  const today = memoryDate(now());
  const yesterday = memoryDate(now() - 24 * 60 * 60 * 1000);
  const rootDir = join(home, ".scorel", "memory");
  const projectDir = join(rootDir, "projects", safeProjectId(options.projectId));
  const dailyDir = join(projectDir, "daily");
  return {
    rootDir,
    rootMemoryPath: join(rootDir, "MEMORY.md"),
    projectDir,
    projectMemoryPath: join(projectDir, "MEMORY.md"),
    dailyDir,
    todayDailyPath: join(dailyDir, `${today}.md`),
    yesterdayDailyPath: join(dailyDir, `${yesterday}.md`),
    dreamStatePath: join(projectDir, "dream-state.json"),
    today,
    yesterday,
  };
};

export const scorelSessionMemoryPaths = (options: {
  projectId: string;
  sessionId: string;
  homeDir?: string;
}): SessionMemoryPaths => {
  const home = options.homeDir ?? homedir();
  const sessionsDir = join(home, ".scorel", "context", "session-memory", safeProjectId(options.projectId));
  return {
    sessionsDir,
    sessionMemoryPath: join(sessionsDir, `${safeProjectId(options.sessionId)}.md`),
  };
};

export const buildMemoryContext = async (options: BuildMemoryContextOptions): Promise<MemoryContext> => {
  const paths = scorelMemoryPaths(options);
  await ensureMemoryFiles(paths);
  return {
    paths,
    rootMemory: trimForContext(await readOptional(paths.rootMemoryPath), 8_000),
    projectMemory: trimForContext(await readOptional(paths.projectMemoryPath), 12_000),
    todayDaily: trimForContext(await readOptional(paths.todayDailyPath), 8_000, "tail"),
    yesterdayDaily: trimForContext(await readOptional(paths.yesterdayDailyPath), 8_000, "tail"),
  };
};

export const renderMemoryHarness = (context: MemoryContext): string => [
  "Memory context for this session.",
  "",
  "Root MEMORY.md:",
  context.rootMemory.trim() || "(empty)",
  "",
  "Project MEMORY.md:",
  context.projectMemory.trim() || "(empty)",
  "",
  `Recent daily (${context.paths.yesterday}, ${context.paths.today}):`,
  context.yesterdayDaily.trim() || "(yesterday empty)",
  "",
  context.todayDaily.trim() || "(today empty)",
  "",
  "Memory rules:",
  "- Treat memory as point-in-time context; verify current code facts from the repo before acting.",
  "- Project MEMORY overrides root MEMORY for project-specific decisions.",
  "- Daily notes are recent progress context, not long-term truth.",
].join("\n");

export const appendDailyEntry = async (options: AppendDailyOptions): Promise<{ path: string; entry: string; date: string }> => {
  const paths = scorelMemoryPaths(options);
  await ensureMemoryFiles(paths);
  const text = options.text.trim();
  if (!text) {
    return { path: paths.todayDailyPath, entry: "", date: paths.today };
  }
  const time = new Date((options.now ?? Date.now)()).toISOString().slice(11, 16);
  const entry = `- ${time} ${text.replace(/\s+/g, " ")}\n`;
  await appendFile(paths.todayDailyPath, entry, "utf8");
  return { path: paths.todayDailyPath, entry: entry.trimEnd(), date: paths.today };
};

export const createAppendDailyTool = (options: CreateAppendDailyToolOptions): AgentTool =>
  defineTool({
    name: "AppendDaily",
    description: [
      "Append a compact hidden project daily journal entry after meaningful work.",
      "Use this once near the end of a completed user turn when there is progress, a decision, or a follow-up worth preserving.",
      "Do not include secrets, raw logs, speculation, or facts that should be re-read from the repository.",
    ].join(" "),
    execute: async (_toolCallId, args) => {
      const input = parseAppendDailyInput(args);
      const result = await appendDailyEntry({
        projectId: options.projectId,
        homeDir: options.homeDir,
        now: options.now,
        text: renderDailyEntry(input),
      });
      await options.onAppend?.(result);
      return {
        content: [{
          type: "text",
          text: result.entry ? `Daily appended: ${result.date}` : "Daily append skipped: empty entry",
        }],
        details: {
          path: result.path,
          date: result.date,
        },
      };
    },
  });

export const renderDailyEntry = (input: AppendDailyInput): string => {
  const sections = [
    `Summary: ${compactLine(input.summary, 500)}`,
    renderList("Completed", input.completed),
    renderList("Decisions", input.decisions),
    renderList("Follow-ups", input.followUps),
    renderList("Memory candidates", input.memoryCandidates),
  ].filter(Boolean);
  return sections.join(" ");
};

export const mergeMemoryMarkdown = (current: string, addition: string): string => {
  const text = addition.trim();
  if (!text) {
    return current;
  }
  const normalized = current.trim() || "# Memory\n";
  if (normalized.includes(text)) {
    return `${normalized.trimEnd()}\n`;
  }
  return `${normalized.trimEnd()}\n\n- ${text.replace(/^-+\s*/, "")}\n`;
};

export const readSessionMemory = async (options: {
  projectId: string;
  sessionId: string;
  homeDir?: string;
}): Promise<string> => {
  const paths = scorelSessionMemoryPaths(options);
  return trimForContext(await readOptional(paths.sessionMemoryPath), 12_000, "tail");
};

export const writeSessionMemory = async (input: SessionMemoryInput): Promise<{ path: string; content: string }> => {
  const paths = scorelSessionMemoryPaths(input);
  await mkdir(paths.sessionsDir, { recursive: true, mode: 0o700 });
  const content = renderSessionMemory(input);
  await writeFile(paths.sessionMemoryPath, content, { encoding: "utf8", mode: 0o600 });
  return { path: paths.sessionMemoryPath, content };
};

export const renderSessionMemory = (input: SessionMemoryInput): string => {
  const timestamp = new Date((input.now ?? Date.now)()).toISOString();
  return normalizeMarkdownFile([
    `# Session Memory: ${input.sessionId}`,
    "",
    `Updated: ${timestamp}`,
    "",
    "## Current State",
    compactLine(input.summary, 1_200) || "- No durable session state captured yet.",
    "",
    "## Recent Work",
    renderBullets(input.recentMessages, 360) || "- No recent work captured.",
    "",
    "## Decisions",
    renderBullets(input.decisions, 360) || "- No session decisions captured.",
    "",
    "## Follow-ups",
    renderBullets(input.followUps, 360) || "- No follow-ups captured.",
  ].join("\n"));
};

const ensureMemoryFiles = async (paths: MemoryPaths): Promise<void> => {
  await mkdir(paths.rootDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.projectDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.dailyDir, { recursive: true, mode: 0o700 });
  await ensureFile(paths.rootMemoryPath, "# Memory\n");
  await ensureFile(paths.projectMemoryPath, "# Project Memory\n");
  await ensureFile(paths.todayDailyPath, `# ${paths.today}\n\n`);
};

const ensureFile = async (path: string, content: string): Promise<void> => {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (cause) {
    if (!isNodeErrorCode(cause, "EEXIST")) {
      throw cause;
    }
  }
};

const readOptional = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT")) {
      return "";
    }
    throw cause;
  }
};

const trimForContext = (text: string, maxChars: number, mode: "head" | "tail" = "head"): string => {
  if (text.length <= maxChars) {
    return text;
  }
  return mode === "tail" ? text.slice(-maxChars) : text.slice(0, maxChars);
};

const compactLine = (value: string, maxChars: number): string =>
  value.replace(/\s+/g, " ").trim().slice(0, maxChars);

const renderList = (label: string, values: string[] | undefined): string => {
  const items = (values ?? []).map((value) => compactLine(value, 240)).filter(Boolean);
  return items.length > 0 ? `${label}: ${items.join("; ")}` : "";
};

const renderBullets = (values: string[] | undefined, maxChars: number): string =>
  (values ?? [])
    .map((value) => compactLine(value, maxChars))
    .filter(Boolean)
    .map((value) => `- ${value}`)
    .join("\n");

export const normalizeMarkdownFile = (value: string): string => `${value.trimEnd()}\n`;

const parseAppendDailyInput = (value: unknown): AppendDailyInput => {
  if (!isRecord(value)) {
    throw new Error("AppendDaily args must be an object");
  }
  const summary = requireString(value.summary, "summary");
  return {
    summary,
    completed: optionalStringArray(value.completed, "completed"),
    decisions: optionalStringArray(value.decisions, "decisions"),
    followUps: optionalStringArray(value.followUps, "followUps"),
    memoryCandidates: optionalStringArray(value.memoryCandidates, "memoryCandidates"),
  };
};

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`AppendDaily.${name} must be a non-empty string`);
  }
  return value.trim();
};

const optionalStringArray = (value: unknown, name: string): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`AppendDaily.${name} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeProjectId = (projectId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error("projectId must contain only letters, numbers, underscores, or hyphens");
  }
  return projectId;
};

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
