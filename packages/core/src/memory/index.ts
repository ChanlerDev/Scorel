import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export type BuildMemoryContextOptions = {
  projectId: string;
  homeDir?: string;
  now?: () => number;
};

export type AppendDailyOptions = BuildMemoryContextOptions & {
  text: string;
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

export const renderAutomaticDailyEntry = (input: { userText: string; assistantText: string }): string => {
  const user = compactLine(input.userText, 180);
  const assistant = compactLine(input.assistantText, 220);
  if (!user && !assistant) {
    return "";
  }
  if (!assistant) {
    return `对话：${user}`;
  }
  if (!user) {
    return `进展：${assistant}`;
  }
  return `进展：${user} -> ${assistant}`;
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

const safeProjectId = (projectId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error("projectId must contain only letters, numbers, underscores, or hyphens");
  }
  return projectId;
};

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
