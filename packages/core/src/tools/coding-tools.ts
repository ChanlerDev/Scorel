import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { Type } from "@earendil-works/pi-ai";

import type { AgentTool, ToolResult } from "./index.js";
import { defineTool } from "./index.js";

const execFileAsync = promisify(execFile);

export type CodingToolsOptions = {
  cwd: string;
  defaultWaitTimeSeconds?: number;
  maxOutputBytes?: number;
  maxReadTokens?: number;
  contextWindow?: number;
  defaultShell?: string;
  toolResultArtifacts?: {
    dir: string;
  };
  tokenSaving?: {
    rtk?: {
      enabled: boolean;
      executable?: string;
    };
  };
  backgroundBash?: BackgroundBashDeliveryHooks;
};

export type BackgroundBashCompletion = {
  task_id: string;
  pid: number;
  cwd: string;
  result: ToolResult;
};

export type BackgroundBashDeliveryHooks = {
  onComplete?: (completion: BackgroundBashCompletion) => Promise<{ eventId?: string } | void>;
  isDeliveryVisible?: (delivery: { task_id: string; eventId?: string }) => boolean;
};

export type BackgroundBashRegistry = {
  hasActiveWork(): boolean;
  start(input: StartBashInput): Promise<BashTaskResult>;
  interact(input: InteractBashInput): Promise<BashTaskResult>;
  stop(taskId: string): Promise<ToolResult>;
};

type StartBashInput = {
  cwd: string;
  waitMs: number;
  outputLimit: number;
  artifactDir?: string;
  toolCallId: string;
  shell: string;
  executionCommand: string;
  displayCommand: string;
  rtk: BashRtkDetails;
  rtkGainBefore?: { savedTokens: number };
  signal: AbortSignal;
};

type InteractBashInput = {
  taskId: string;
  command?: string;
  waitMs: number;
  outputLimit: number;
  artifactDir?: string;
  toolCallId: string;
};

type BashTaskResult =
  | { status: "running"; taskId: string; pid: number; cwd: string }
  | { status: "delivered"; taskId: string; pid: number; eventId?: string }
  | { status: "completed"; taskId: string; pid: number; result: ToolResult };

type BashRtkDetails = {
  enabled: boolean;
  applied: boolean;
  executable?: string;
  rewrittenCommand?: string;
  estimatedSavedTokens?: number;
};

type FileReadSnapshot = {
  content: string;
  hash: string;
  mtimeMs: number;
  ranges: ReadRange[];
  size: number;
  totalLines: number;
};

type ReadRange = {
  startLine: number;
  endLine: number;
};

type CodingToolsState = {
  reads: Map<string, FileReadSnapshot>;
  todos: TodoItem[];
};

type ReadArgs = {
  path: string;
  offset?: number;
  limit?: number;
  full?: boolean;
};

type WriteArgs = {
  path: string;
  content: string;
};

type EditArgs = {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

type BashArgs = {
  command?: string;
  cwd?: string;
  taskId?: string;
  waitTimeSeconds?: number;
  description?: string;
};

type GlobArgs = {
  pattern: string;
  path?: string;
  head_limit?: number;
  offset?: number;
};

type GrepArgs = {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: "files" | "content" | "count";
  before_context?: number;
  after_context?: number;
  context?: number;
  line_numbers?: boolean;
  case_insensitive?: boolean;
  type?: string;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
};

type TodoStatus = "pending" | "in_progress" | "completed";

type TodoItem = {
  content: string;
  status: TodoStatus;
  activeForm?: string;
};

type TodoWriteArgs = {
  todos: TodoItem[];
};

const DEFAULT_SEARCH_LIMIT = 100;
const DEFAULT_GREP_LIMIT = 250;
const DEFAULT_READ_LIMIT = 2_000;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const READ_TOKEN_BUDGET_RATIO = 0.01;
const FULL_READ_TOKEN_BUDGET_RATIO = 0.1;

export const createCodingTools = (options: CodingToolsOptions): AgentTool[] => {
  const root = resolve(options.cwd);
  const state: CodingToolsState = { reads: new Map(), todos: [] };
  const defaultWaitMs = Math.max(0, (options.defaultWaitTimeSeconds ?? 60) * 1_000);
  const maxOutputBytes = options.maxOutputBytes ?? 16_000;
  const normalReadTokens = options.maxReadTokens ?? readTokenBudget(options.contextWindow, READ_TOKEN_BUDGET_RATIO);
  const fullReadTokens = options.maxReadTokens ?? readTokenBudget(options.contextWindow, FULL_READ_TOKEN_BUDGET_RATIO);
  const defaultShell = resolveDefaultShell(options.defaultShell);
  const bashRegistry = createBackgroundBashRegistry({ delivery: options.backgroundBash });

  const resolveWorkspacePath = (input: string): string => {
    if (input.length === 0) {
      throw new Error("path must not be empty");
    }
    const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input);
    if (!isWithin(root, candidate)) {
      throw new Error(`path escapes workspace: ${input}`);
    }
    return candidate;
  };

  const workspaceTarget = (input: string | undefined): string => {
    const target = input ? resolveWorkspacePath(input) : root;
    return relative(root, target) || ".";
  };

  const assertFreshReadableCoverage = async (path: string, toolName: string): Promise<FileReadSnapshot> => {
    const snapshot = state.reads.get(path);
    if (!snapshot) {
      throw new Error(`Read must be used before ${toolName} on existing file: ${path}`);
    }
    if (!hasCompleteCoverage(snapshot.ranges, snapshot.totalLines)) {
      throw new Error(`The complete file must be read before ${toolName} on existing file: ${path}`);
    }
    const current = await snapshotFile(path);
    if (!sameSnapshot(snapshot, current)) {
      throw new Error(`File changed since last Read: ${path}`);
    }
    return snapshot;
  };

  return [
    defineTool({
      name: "Read",
      description:
        "Read a text file from the workspace. Long reads are truncated by complete lines; accumulated coverage unlocks Write/Edit.",
      parameters: Type.Object({
        file_path: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
        full: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, args) => {
        const input = parseReadArgs(args);
        if (input.full && (input.offset !== undefined || input.limit !== undefined)) {
          throw new Error("full cannot be combined with offset or limit");
        }
        const path = resolveWorkspacePath(input.path);
        assertReadableFileKind(path);
        const fileStat = await stat(path);
        if (fileStat.isDirectory()) {
          throw new Error(`Read cannot read a directory: ${input.path}. Use Glob to find files.`);
        }

        const buffer = await readFile(path);
        assertTextBuffer(buffer, input.path);
        const content = buffer.toString("utf8");
        const lines = linesOf(content);
        const offset = input.offset ?? 1;
        const limit = input.full ? Math.max(lines.length, 1) : (input.limit ?? DEFAULT_READ_LIMIT);
        if (!Number.isInteger(offset) || offset < 1) {
          throw new Error("offset must be a positive integer");
        }
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("limit must be a positive integer");
        }

        const startIndex = offset - 1;
        const candidate = lines.slice(startIndex, startIndex + limit);
        const tokenBudget = input.full ? fullReadTokens : normalReadTokens;
        const selected = selectCompleteLinesWithinBudget(candidate, offset, tokenBudget);
        const endLine = selected.length === 0 ? offset - 1 : offset + selected.length - 1;
        const truncated = startIndex + selected.length < lines.length;
        const nextOffset = truncated ? endLine + 1 : null;
        const current = await snapshotFile(path, content);
        const previous = state.reads.get(path);
        const previousRanges = previous && sameSnapshot(previous, current) ? previous.ranges : [];
        const currentRange = selected.length > 0 ? [{ startLine: offset, endLine }] : [];
        const ranges = mergeRanges([...previousRanges, ...currentRange]);
        const canWrite = hasCompleteCoverage(ranges, lines.length);
        state.reads.set(path, { ...current, ranges });

        const rendered = renderReadLines(selected, offset);
        const truncationNotice = truncated
          ? `\n\n[Showing lines ${offset}-${endLine}/${lines.length}. Next offset: ${nextOffset}.]`
          : "";
        const text = `${rendered}${truncationNotice}`;

        return textResult(text, {
          path,
          startLine: offset,
          endLine,
          totalLines: lines.length,
          truncated,
          nextOffset,
          size: fileStat.size,
          estimatedTokens: estimateTokens(rendered),
          tokenBudget,
          canWrite,
        });
      },
    }),
    defineTool({
      name: "Write",
      description:
        "Create a new file or fully overwrite an existing file. Existing files require complete read coverage of the current file.",
      parameters: Type.Object({
        file_path: Type.String(),
        content: Type.String(),
      }),
      execute: async (_toolCallId, args) => {
        const input = parseWriteArgs(args);
        const path = resolveWorkspacePath(input.path);
        const previous = (await exists(path)) ? await assertFreshReadableCoverage(path, "Write") : undefined;

        await mkdir(dirname(path), { recursive: true });
        await atomicWriteFile(path, input.content);
        state.reads.set(path, await snapshotFile(path, input.content, completeRanges(linesOf(input.content).length)));

        const type = previous ? "update" : "create";
        return textResult(
          type === "create" ? `File created successfully at: ${path}` : `The file ${path} has been updated successfully.`,
          {
            type,
            filePath: path,
            bytes: byteLength(input.content),
          },
        );
      },
    }),
    defineTool({
      name: "Edit",
      description:
        "Perform an exact string replacement in an existing file. Requires complete read coverage and a unique old_string unless replace_all is true.",
      parameters: Type.Object({
        file_path: Type.String(),
        old_string: Type.String(),
        new_string: Type.String(),
        replace_all: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, args) => {
        const input = parseEditArgs(args);
        const path = resolveWorkspacePath(input.path);
        await assertFreshReadableCoverage(path, "Edit");
        if (input.old_string === input.new_string) {
          throw new Error("old_string and new_string must differ");
        }

        const content = await readFile(path, "utf8");
        const count = countOccurrences(content, input.old_string);
        if (count === 0) {
          throw new Error(`String to replace not found in file.\nString: ${input.old_string}`);
        }
        if (count > 1 && !input.replace_all) {
          throw new Error(
            `Found ${count} matches of the string to replace, but replace_all is false. Provide more context or set replace_all to true.\nString: ${input.old_string}`,
          );
        }

        const next = input.replace_all
          ? content.split(input.old_string).join(input.new_string)
          : content.replace(input.old_string, input.new_string);
        await atomicWriteFile(path, next);
        state.reads.set(path, await snapshotFile(path, next, completeRanges(linesOf(next).length)));
        return textResult(
          input.replace_all
            ? `The file ${path} has been updated. All occurrences were successfully replaced.`
            : `The file ${path} has been updated successfully.`,
          {
            filePath: path,
            replacements: input.replace_all ? count : 1,
            replaceAll: input.replace_all ?? false,
          },
        );
      },
    }),
    defineTool({
      name: "Bash",
      description: [
        "Execute a shell command in the workspace.",
        "If the command does not finish within wait_time seconds, it continues in the background and returns a task_id.",
        "Call Bash again with task_id to wait for output; include command with task_id to write those exact bytes to stdin.",
        "The command field is used both to start a new process and to send stdin to an existing background process.",
        "Final output is returned using the normal Bash result format; oversized results are archived automatically.",
      ].join(" "),
      parameters: Type.Object({
        command: Type.Optional(Type.String()),
        cwd: Type.Optional(Type.String()),
        task_id: Type.Optional(Type.String()),
        wait_time: Type.Optional(Type.Number()),
        description: Type.Optional(Type.String()),
      }),
      execute: async (toolCallId, args, signal) => {
        const input = parseBashArgs(args);
        const waitMs = input.waitTimeSeconds === undefined ? defaultWaitMs : Math.max(0, input.waitTimeSeconds * 1_000);
        const outputLimit = maxOutputBytes;
        if (input.taskId) {
          const result = await bashRegistry.interact({
            taskId: input.taskId,
            command: input.command,
            waitMs,
            outputLimit,
            artifactDir: options.toolResultArtifacts?.dir,
            toolCallId,
          });
          return projectBashTaskResult(result);
        }
        if (!input.command) {
          throw new Error("Bash requires command when task_id is not provided");
        }
        const commandCwd = input.cwd ? resolveWorkspacePath(input.cwd) : root;
        const rtk = options.tokenSaving?.rtk;
        const rtkCommand = await resolveRtkCommand(rtk, input.command);
        const command = rtkCommand.rewrittenCommand ?? input.command;
        const executionCommand = rtkCommand.executionCommand ?? input.command;
        const rtkGainBefore = rtkCommand.applied && rtk?.executable ? await readRtkGain(rtk.executable, commandCwd) : undefined;
        const rtkResult = {
          enabled: rtk?.enabled === true,
          applied: rtkCommand.applied,
          ...(rtk?.executable ? { executable: rtk.executable } : {}),
          ...(rtkCommand.rewrittenCommand ? { rewrittenCommand: rtkCommand.rewrittenCommand } : {}),
        };

        const result = await bashRegistry.start({
          cwd: commandCwd,
          waitMs,
          outputLimit,
          artifactDir: options.toolResultArtifacts?.dir,
          toolCallId,
          shell: defaultShell,
          executionCommand,
          displayCommand: command,
          rtk: rtkResult,
          rtkGainBefore,
          signal,
        });
        return projectBashTaskResult(result);
      },
      hasActiveWork: () => bashRegistry.hasActiveWork(),
    }),
    defineTool({
      name: "BashStop",
      description: "Stop a background Bash task by task_id. Use this instead of killing the PID directly.",
      parameters: Type.Object({
        task_id: Type.String(),
      }),
      execute: async (_toolCallId, args) => {
        const input = expectRecord(args);
        return bashRegistry.stop(expectString(input.task_id, "task_id"));
      },
    }),
    defineTool({
      name: "Glob",
      description: "Find files by glob pattern using ripgrep file discovery.",
      parameters: Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        head_limit: Type.Optional(Type.Number()),
        offset: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId, args, signal) => {
        const input = parseGlobArgs(args);
        const limit = input.head_limit ?? DEFAULT_SEARCH_LIMIT;
        const offset = input.offset ?? 0;
        const all = (await runRipgrep(["--files", "--hidden", "--glob", input.pattern, ...vcsExcludes()], workspaceTarget(input.path), root, signal))
          .sort((left, right) => toWorkspaceRelative(root)(left).localeCompare(toWorkspaceRelative(root)(right)));
        const selected = paginate(all, limit, offset);
        const text = selected.items.map(toWorkspaceRelative(root)).join("\n");
        return textResult(text || "No files found", {
          filenames: selected.items.map(toWorkspaceRelative(root)),
          numFiles: selected.items.length,
          totalFiles: all.length,
          truncated: selected.truncated,
          ...(selected.appliedLimit !== undefined ? { appliedLimit: selected.appliedLimit } : {}),
          ...(offset > 0 ? { appliedOffset: offset } : {}),
        });
      },
    }),
    defineTool({
      name: "Grep",
      description:
        'Search file contents with ripgrep. Default output_mode is "files" for matching paths; use "content" for matching lines or "count" for match counts.',
      parameters: Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        glob: Type.Optional(Type.String()),
        output_mode: Type.Optional(Type.Union([Type.Literal("files"), Type.Literal("content"), Type.Literal("count")])),
        "-B": Type.Optional(Type.Number()),
        "-A": Type.Optional(Type.Number()),
        "-C": Type.Optional(Type.Number()),
        context: Type.Optional(Type.Number()),
        "-n": Type.Optional(Type.Boolean()),
        "-i": Type.Optional(Type.Boolean()),
        type: Type.Optional(Type.String()),
        head_limit: Type.Optional(Type.Number()),
        offset: Type.Optional(Type.Number()),
        multiline: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, args, signal) => {
        const input = parseGrepArgs(args);
        const mode = input.output_mode ?? "files";
        const limit = input.head_limit ?? DEFAULT_GREP_LIMIT;
        const offset = input.offset ?? 0;
        const rgArgs = grepArgs(input, mode);
        const raw = await runRipgrep(rgArgs, workspaceTarget(input.path), root, signal);

        if (mode === "content") {
          const selected = paginate(raw, limit, offset);
          const lines = selected.items.map(relativizeGrepLine(root));
          return textResult(formatPaginatedText(lines, selected, offset), {
            mode,
            content: lines.join("\n"),
            numLines: lines.length,
            filenames: [],
            numFiles: 0,
            ...(selected.appliedLimit !== undefined ? { appliedLimit: selected.appliedLimit } : {}),
            ...(offset > 0 ? { appliedOffset: offset } : {}),
          });
        }

        if (mode === "count") {
          const selected = paginate(raw, limit, offset);
          const lines = selected.items.map(relativizeCountLine(root));
          const counts = parseCountLines(lines);
          return textResult(formatPaginatedText(lines, selected, offset), {
            mode,
            content: lines.join("\n"),
            filenames: [],
            numFiles: counts.files,
            numMatches: counts.matches,
            ...(selected.appliedLimit !== undefined ? { appliedLimit: selected.appliedLimit } : {}),
            ...(offset > 0 ? { appliedOffset: offset } : {}),
          });
        }

        const sorted = await sortPathsByMtime(root, raw);
        const selected = paginate(sorted, limit, offset);
        const filenames = selected.items.map(toWorkspaceRelative(root));
        return textResult(
          filenames.length === 0
            ? "No files found"
            : `Found ${filenames.length} ${filenames.length === 1 ? "file" : "files"}${formatLimitSuffix(selected, offset)}\n${filenames.join("\n")}`,
          {
            mode,
            filenames,
            numFiles: filenames.length,
            ...(selected.appliedLimit !== undefined ? { appliedLimit: selected.appliedLimit } : {}),
            ...(offset > 0 ? { appliedOffset: offset } : {}),
          },
        );
      },
    }),
    defineTool({
      name: "TodoWrite",
      description: "Replace the current session todo list with a complete updated list.",
      parameters: Type.Object({
        todos: Type.Array(
          Type.Object({
            content: Type.String(),
            status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
            activeForm: Type.Optional(Type.String()),
          }),
        ),
      }),
      execute: async (_toolCallId, args) => {
        const input = parseTodoWriteArgs(args);
        const oldTodos = state.todos;
        const allDone = input.todos.length > 0 && input.todos.every((todo) => todo.status === "completed");
        state.todos = allDone ? [] : input.todos;
        const message = allDone
          ? "Todos have been modified successfully. All items are completed, so the current todo list has been cleared."
          : "Todos have been modified successfully. Continue using the todo list to track progress.";
        return textResult(message, { oldTodos, currentTodos: state.todos });
      },
    }),
  ];
};

const parseReadArgs = (args: unknown): ReadArgs => {
  const input = expectRecord(args);
  return {
    path: expectPath(input),
    offset: optionalNumber(input.offset, "offset"),
    limit: optionalNumber(input.limit, "limit"),
    full: optionalBoolean(input.full, "full"),
  };
};

const parseWriteArgs = (args: unknown): WriteArgs => {
  const input = expectRecord(args);
  return {
    path: expectPath(input),
    content: expectString(input.content, "content"),
  };
};

const parseEditArgs = (args: unknown): EditArgs => {
  const input = expectRecord(args);
  return {
    path: expectPath(input),
    old_string: expectString(input.old_string, "old_string"),
    new_string: expectString(input.new_string, "new_string"),
    replace_all: optionalBoolean(input.replace_all, "replace_all"),
  };
};

const parseBashArgs = (args: unknown): BashArgs => {
  const input = expectRecord(args);
  return {
    command: optionalString(input.command, "command"),
    cwd: optionalString(input.cwd, "cwd"),
    taskId: optionalString(input.task_id, "task_id"),
    waitTimeSeconds: optionalNumber(input.wait_time, "wait_time"),
    description: optionalString(input.description, "description"),
  };
};

const parseGlobArgs = (args: unknown): GlobArgs => {
  const input = expectRecord(args);
  return {
    pattern: expectString(input.pattern, "pattern"),
    path: optionalString(input.path ?? input.cwd, "path"),
    head_limit: optionalNumber(input.head_limit ?? input.maxResults, "head_limit"),
    offset: optionalNumber(input.offset, "offset"),
  };
};

const parseGrepArgs = (args: unknown): GrepArgs => {
  const input = expectRecord(args);
  const outputMode = optionalString(input.output_mode ?? input.outputMode, "output_mode");
  if (
    outputMode !== undefined &&
    outputMode !== "files" &&
    outputMode !== "content" &&
    outputMode !== "count"
  ) {
    throw new Error("output_mode must be files, content, or count");
  }
  return {
    pattern: expectString(input.pattern, "pattern"),
    path: optionalString(input.path ?? input.cwd, "path"),
    glob: optionalString(input.glob, "glob"),
    output_mode: outputMode,
    before_context: optionalNumber(input["-B"], "-B"),
    after_context: optionalNumber(input["-A"], "-A"),
    context: optionalNumber(input.context ?? input["-C"], "context"),
    line_numbers: optionalBoolean(input["-n"], "-n"),
    case_insensitive: optionalBoolean(input["-i"] ?? input.case_insensitive, "-i"),
    type: optionalString(input.type, "type"),
    head_limit: optionalNumber(input.head_limit ?? input.maxResults, "head_limit"),
    offset: optionalNumber(input.offset, "offset"),
    multiline: optionalBoolean(input.multiline, "multiline"),
  };
};

const parseTodoWriteArgs = (args: unknown): TodoWriteArgs => {
  const input = expectRecord(args);
  if (!Array.isArray(input.todos)) {
    throw new Error("todos must be an array");
  }
  const todos = input.todos.map(parseTodoItem);
  const inProgressCount = todos.filter((todo) => todo.status === "in_progress").length;
  if (inProgressCount > 1) {
    throw new Error("TodoWrite allows at most one in_progress item");
  }
  return { todos };
};

const parseTodoItem = (value: unknown): TodoItem => {
  const input = expectRecord(value);
  const status = expectString(input.status, "status");
  if (status !== "pending" && status !== "in_progress" && status !== "completed") {
    throw new Error("status must be pending, in_progress, or completed");
  }
  return {
    content: expectString(input.content, "content"),
    status,
    activeForm: optionalString(input.activeForm, "activeForm"),
  };
};

const expectRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("tool args must be an object");
  }
  return value as Record<string, unknown>;
};

const expectPath = (input: Record<string, unknown>): string => expectString(input.file_path ?? input.path, "file_path");

const expectString = (value: unknown, name: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

const optionalString = (value: unknown, name: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return expectString(value, name);
};

const optionalNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const optionalBoolean = (value: unknown, name: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
};

const snapshotFile = async (path: string, content?: string, ranges?: ReadRange[]): Promise<FileReadSnapshot> => {
  const [fileStat, fileContent] = await Promise.all([stat(path), content ?? readFile(path, "utf8")]);
  const totalLines = linesOf(fileContent).length;
  return {
    content: fileContent,
    hash: createHash("sha256").update(fileContent).digest("hex"),
    mtimeMs: fileStat.mtimeMs,
    ranges: ranges ?? [],
    size: fileStat.size,
    totalLines,
  };
};

const sameSnapshot = (left: FileReadSnapshot, right: FileReadSnapshot): boolean =>
  left.hash === right.hash && left.size === right.size && left.mtimeMs === right.mtimeMs;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const isWithin = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const linesOf = (content: string): string[] => {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".ico"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const BINARY_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".dmg",
  ".pkg",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".jar",
  ".wasm",
  ".pyc",
  ".sqlite",
  ".db",
]);

const assertReadableFileKind = (path: string): void => {
  const ext = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`Read does not yet support image files (${ext}). A dedicated image Read path is planned; do not read this file as text.`);
  }
  if (DOCUMENT_EXTENSIONS.has(ext)) {
    throw new Error(`Read does not yet support document files (${ext}). PDF/page and document-aware Read support is planned; do not read this file as text.`);
  }
  if (BINARY_EXTENSIONS.has(ext)) {
    throw new Error(`Read cannot read binary files (${ext}). Use an appropriate binary/document tool instead.`);
  }
};

const assertTextBuffer = (buffer: Buffer, path: string): void => {
  if (buffer.includes(0)) {
    throw new Error(`Read cannot read binary file as text: ${path}`);
  }
  const decoded = buffer.toString("utf8");
  const replacementChars = decoded.match(/\uFFFD/g)?.length ?? 0;
  if (replacementChars > 0 && replacementChars / Math.max(decoded.length, 1) > 0.01) {
    throw new Error(`Read cannot safely decode file as UTF-8 text: ${path}`);
  }
};

const selectCompleteLinesWithinBudget = (
  lines: string[],
  offset: number,
  maxTokens: number,
): string[] => {
  let selected = lines;
  while (selected.length > 0 && estimateTokens(renderReadLines(selected, offset)) > maxTokens) {
    selected = selected.slice(0, -1);
  }
  if (selected.length === 0 && lines.length > 0) {
    throw new Error(
      `Line ${offset} exceeds Read output token budget (${maxTokens} estimated tokens). Use Grep or a more specific tool; Read will not return partial lines.`,
    );
  }
  return selected;
};

const estimateTokens = (value: string): number => Math.ceil(value.length / 3);

const renderReadLines = (lines: string[], offset: number): string =>
  lines.map((line, index) => `${String(offset + index).padStart(6, " ")}\t${line}`).join("\n");

const readTokenBudget = (contextWindow: number | undefined, ratio: number): number => {
  const window = contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  if (!Number.isFinite(window) || window <= 0) {
    return Math.max(1, Math.floor(DEFAULT_CONTEXT_WINDOW * ratio));
  }
  return Math.max(1, Math.floor(window * ratio));
};

const completeRanges = (totalLines: number): ReadRange[] => (totalLines === 0 ? [] : [{ startLine: 1, endLine: totalLines }]);

const hasCompleteCoverage = (ranges: ReadRange[], totalLines: number): boolean => {
  if (totalLines === 0) {
    return true;
  }
  const merged = mergeRanges(ranges);
  return merged.length === 1 && merged[0]?.startLine === 1 && merged[0].endLine >= totalLines;
};

const mergeRanges = (ranges: ReadRange[]): ReadRange[] => {
  const sorted = ranges
    .filter((range) => range.startLine <= range.endLine)
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  const merged: ReadRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (!last || range.startLine > last.endLine + 1) {
      merged.push({ ...range });
      continue;
    }
    last.endLine = Math.max(last.endLine, range.endLine);
  }
  return merged;
};

const countOccurrences = (content: string, needle: string): number => {
  if (needle.length === 0) {
    throw new Error("old_string must not be empty");
  }
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
};

const atomicWriteFile = async (path: string, content: string): Promise<void> => {
  const temp = resolve(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, path);
  } catch (cause) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw cause;
  }
};

export const createBackgroundBashRegistry = (options: { delivery?: BackgroundBashDeliveryHooks } = {}): BackgroundBashRegistry => {
  const tasks = new Map<string, BashTask>();

  const finishResult = async (task: BashTask, toolCallId: string, outputLimit: number, artifactDir?: string): Promise<ToolResult> => {
    const rtkSavedTokens = task.rtk.executable
      ? await rtkSavedTokenDelta(task.rtk.executable, task.cwd, task.rtkGainBefore)
      : undefined;
    const result = await bashResult({
      exitCode: task.exitCode ?? 1,
      stdout: task.stdout,
      stderr: task.stderr,
      cwd: task.cwd,
      outputLimit,
      artifactDir,
      toolCallId,
      shell: task.shell,
      command: task.displayCommand,
      pid: task.pid,
      taskId: task.taskId,
      rtk: withRtkSavings(task.rtk, rtkSavedTokens),
    });
    return {
      ...result,
      details: {
        ...(isRecord(result.details) ? result.details : {}),
        task_id: task.taskId,
        pid: task.pid,
      },
    };
  };

  const project = async (task: BashTask, waitMs: number, toolCallId: string, outputLimit: number, artifactDir?: string): Promise<BashTaskResult> => {
    task.activeWaiters += 1;
    try {
      await waitForTask(task, waitMs);
    } finally {
      task.activeWaiters -= 1;
    }
    if (!task.completed) {
      return { status: "running", taskId: task.taskId, pid: task.pid, cwd: task.cwd };
    }
    if (task.deliveryPromise) {
      await task.deliveryPromise;
    }
    if (task.deliveredEventId && options.delivery?.isDeliveryVisible?.({ task_id: task.taskId, eventId: task.deliveredEventId })) {
      return { status: "delivered", taskId: task.taskId, pid: task.pid, eventId: task.deliveredEventId };
    }
    return {
      status: "completed",
      taskId: task.taskId,
      pid: task.pid,
      result: await finishResult(task, toolCallId, outputLimit, artifactDir),
    };
  };

  const maybeDeliver = (task: BashTask): void => {
    if (!task.completed || !task.returnedRunning || task.activeWaiters > 0 || task.deliveryStarted || !options.delivery?.onComplete) {
      return;
    }
    task.deliveryStarted = true;
    task.deliveryPromise = finishResult(task, task.toolCallId, task.outputLimit, task.artifactDir)
      .then((result) => options.delivery?.onComplete?.({
        task_id: task.taskId,
        pid: task.pid,
        cwd: task.cwd,
        result,
      }))
      .then((delivery) => {
        if (delivery?.eventId) {
          task.deliveredEventId = delivery.eventId;
        }
      })
      .catch((cause) => {
        task.deliveryStarted = false;
        task.stderr += task.stderr ? `\n${errorMessage(cause)}` : errorMessage(cause);
      });
  };

  const markCompleted = (task: BashTask, exitCode: number, signal?: NodeJS.Signals): void => {
    task.completed = true;
    task.exitCode = exitCode;
    task.exitSignal = signal;
    maybeDeliver(task);
  };

  return {
    hasActiveWork() {
      return [...tasks.values()].some((task) => !task.completed);
    },
    async start(input) {
      const taskId = `task_${randomUUID()}`;
      const child = spawn(input.shell, shellCommandArgs(input.shell, input.executionCommand), {
        cwd: input.cwd,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const task: BashTask = {
        taskId,
        child,
        pid: child.pid ?? -1,
        cwd: input.cwd,
        shell: input.shell,
        displayCommand: input.displayCommand,
        stdout: "",
        stderr: "",
        completed: false,
        returnedRunning: false,
        activeWaiters: 0,
        deliveryStarted: false,
        toolCallId: input.toolCallId,
        outputLimit: input.outputLimit,
        artifactDir: input.artifactDir,
        rtk: input.rtk,
        rtkGainBefore: input.rtkGainBefore,
      };
      tasks.set(taskId, task);
      child.stdout.on("data", (chunk) => {
        task.stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        task.stderr += chunk.toString();
      });
      child.once("close", (code, signal) => {
        markCompleted(task, typeof code === "number" ? code : signalExitCode(signal), signal ?? undefined);
      });
      child.once("error", (error) => {
        task.stderr += task.stderr ? `\n${error.message}` : error.message;
        markCompleted(task, 1);
      });
      const abort = () => {
        stopTaskProcess(task);
      };
      if (input.signal.aborted) {
        abort();
      } else {
        input.signal.addEventListener("abort", abort, { once: true });
      }
      const result = await project(task, input.waitMs, input.toolCallId, input.outputLimit, input.artifactDir);
      input.signal.removeEventListener("abort", abort);
      if (result.status === "running") {
        task.returnedRunning = true;
        task.child.unref();
        maybeDeliver(task);
      }
      return result;
    },
    async interact(input) {
      const task = tasks.get(input.taskId);
      if (!task) {
        throw new Error(`Unknown Bash task: ${input.taskId}`);
      }
      if (input.command !== undefined) {
        if (task.completed) {
          throw new Error(`Bash task already completed: ${input.taskId}`);
        }
        task.child.stdin.write(input.command);
      }
      const result = await project(task, input.waitMs, input.toolCallId, input.outputLimit, input.artifactDir);
      if (result.status === "running") {
        task.returnedRunning = true;
      }
      return result;
    },
    async stop(taskId) {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown Bash task: ${taskId}`);
      }
      if (!task.completed) {
        stopTaskProcess(task);
        await waitForTask(task, 1_000);
      }
      return textResult(`Bash task stopped: ${taskId}`, {
        task_id: taskId,
        pid: task.pid,
        status: "stopped",
      });
    },
  };
};

type BashTask = {
  taskId: string;
  child: ChildProcessWithoutNullStreams;
  pid: number;
  cwd: string;
  shell: string;
  displayCommand: string;
  stdout: string;
  stderr: string;
  completed: boolean;
  returnedRunning: boolean;
  activeWaiters: number;
  deliveryStarted: boolean;
  deliveryPromise?: Promise<void>;
  deliveredEventId?: string;
  toolCallId: string;
  outputLimit: number;
  artifactDir?: string;
  exitCode?: number;
  exitSignal?: NodeJS.Signals;
  rtk: BashRtkDetails;
  rtkGainBefore?: { savedTokens: number };
};

const projectBashTaskResult = (result: BashTaskResult): ToolResult => {
  if (result.status === "completed") {
    return result.result;
  }
  if (result.status === "delivered") {
    return textResult(
      [
        `Bash task ${result.taskId} has already been injected through a system reminder.`,
        "Do not read it again unless the user explicitly asks for the raw result.",
      ].join("\n"),
      {
        status: "delivered",
        task_id: result.taskId,
        pid: result.pid,
        ...(result.eventId ? { event_id: result.eventId } : {}),
      },
    );
  }
  return textResult(`status: running\ntask_id: ${result.taskId}\npid: ${result.pid}`, {
    status: "running",
    task_id: result.taskId,
    pid: result.pid,
    cwd: result.cwd,
  });
};

const waitForTask = (task: BashTask, waitMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (task.completed || waitMs <= 0) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, waitMs);
    const onDone = () => {
      clearTimeout(timeout);
      resolve();
    };
    task.child.once("close", onDone);
    task.child.once("error", onDone);
  });

const stopTaskProcess = (task: BashTask): void => {
  try {
    if (task.pid > 0) {
      process.kill(-task.pid, "SIGTERM");
      return;
    }
  } catch {
    // Fall back to the direct child below.
  }
  task.child.kill("SIGTERM");
};

const signalExitCode = (signal: NodeJS.Signals | null): number => signal ? 128 + signalNumber(signal) : 1;

const signalNumber = (signal: NodeJS.Signals): number => {
  if (signal === "SIGTERM") return 15;
  if (signal === "SIGKILL") return 9;
  if (signal === "SIGINT") return 2;
  return 1;
};

const bashResult = async (input: {
  exitCode: number;
  stdout: string;
  stderr: string;
  cwd: string;
  outputLimit: number;
  artifactDir?: string;
  toolCallId: string;
  shell?: string;
  command?: string;
  pid?: number;
  taskId?: string;
  rtk?: {
    enabled: boolean;
    applied: boolean;
    executable?: string;
    rewrittenCommand?: string;
    estimatedSavedTokens?: number;
  };
}): Promise<ToolResult> => {
  const stdoutBytes = Buffer.byteLength(input.stdout);
  const stderrBytes = Buffer.byteLength(input.stderr);
  const fullResult = renderFullBashResult(input);
  const resultBytes = Buffer.byteLength(fullResult);
  const shouldArchive = Boolean(input.artifactDir) && resultBytes > input.outputLimit;
  const artifactPath = shouldArchive && input.artifactDir
    ? await writeBashArtifact(input.artifactDir, input.toolCallId, fullResult)
    : undefined;
  const projection = artifactPath
    ? projectBashStreams(input.stdout, input.stderr, input.outputLimit)
    : undefined;
  const stdout = projection?.stdout ?? truncate(input.stdout, input.outputLimit, "stdout");
  const stderr = projection?.stderr ?? truncate(input.stderr, input.outputLimit, "stderr");
  const text = artifactPath
    ? [
        `exitCode: ${input.exitCode}`,
        `cwd: ${input.cwd}`,
        `artifact: ${artifactPath}`,
        `resultBytes: ${resultBytes}`,
        `stdoutBytes: ${stdoutBytes}`,
        `stderrBytes: ${stderrBytes}`,
        ...(projection?.lines ?? []),
      ].join("\n")
    : `exitCode: ${input.exitCode}\ncwd: ${input.cwd}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
  return textResult(text, {
    exitCode: input.exitCode,
    cwd: input.cwd,
    ...(artifactPath ? {
      artifact: {
        path: artifactPath,
        resultBytes,
        stdoutBytes,
        stderrBytes,
      },
    } : {}),
    ...(input.shell ? { shell: input.shell } : {}),
    ...(input.command ? { command: input.command } : {}),
    ...(input.pid ? { pid: input.pid } : {}),
    ...(input.taskId ? { task_id: input.taskId } : {}),
    ...(input.rtk ? {
      rtk: {
        ...input.rtk,
        estimatedOutputTokens: estimateTokens(`${stdout}\n${stderr}`),
      },
    } : {}),
  });
};

const renderFullBashResult = (input: { exitCode: number; cwd: string; stdout: string; stderr: string }): string =>
  `exitCode: ${input.exitCode}\ncwd: ${input.cwd}\nstdout:\n${input.stdout}\nstderr:\n${input.stderr}`;

const writeBashArtifact = async (artifactDir: string, toolCallId: string, content: string): Promise<string> => {
  const directory = resolve(artifactDir, safeArtifactSegment(toolCallId));
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "result.txt");
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  return path;
};

const safeArtifactSegment = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "tool_call";

const projectBashStreams = (
  stdout: string,
  stderr: string,
  maxBytes: number,
): { lines: string[]; stdout: string; stderr: string } => {
  const streams = [
    { label: "stdout", value: stdout },
    { label: "stderr", value: stderr },
  ].filter((stream) => Buffer.byteLength(stream.value) > 0);
  if (streams.length === 0) {
    return { lines: ["stdout:", "", "stderr:", ""], stdout: "", stderr: "" };
  }
  const perStreamBudget = Math.max(1, Math.floor(maxBytes / streams.length));
  const projected = streams.map((stream) => projectOutputStream(stream.value, perStreamBudget, stream.label));
  const stdoutText = projected.find((stream) => stream.label === "stdout")?.text ?? "stdout:\n";
  const stderrText = projected.find((stream) => stream.label === "stderr")?.text ?? "stderr:\n";
  return {
    lines: projected.map((stream) => stream.text),
    stdout: stdoutText,
    stderr: stderrText,
  };
};

const projectOutputStream = (value: string, maxBytes: number, label: string): { label: string; text: string } => {
  const bytes = Buffer.byteLength(value);
  if (bytes <= maxBytes) {
    return { label, text: `${label}:\n${value}` };
  }
  const headBytes = Math.max(1, Math.floor(maxBytes / 2));
  const tailBytes = Math.max(1, maxBytes - headBytes);
  return {
    label,
    text: [
      `${label} head:`,
      sliceBytes(value, 0, headBytes),
      `${label} tail:`,
      sliceBytes(value, Math.max(0, bytes - tailBytes), bytes),
      `[${label} archived: ${bytes} bytes; projection budget ${maxBytes} bytes]`,
    ].join("\n"),
  };
};

const resolveDefaultShell = (input: string | undefined): string => {
  const shell = input || process.env.SHELL || userShell() || "/bin/sh";
  return shell.trim() || "/bin/sh";
};

const resolveRtkCommand = async (
  rtk: NonNullable<CodingToolsOptions["tokenSaving"]>["rtk"] | undefined,
  command: string,
): Promise<{ applied: boolean; rewrittenCommand?: string; executionCommand?: string }> => {
  if (rtk?.enabled !== true || typeof rtk.executable !== "string" || rtk.executable.length === 0) {
    return { applied: false };
  }
  try {
    const result = await execFileAsync(rtk.executable, ["rewrite", command], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return rtkRewriteResult(result.stdout, rtk.executable);
  } catch (cause) {
    if (isExecError(cause) && typeof cause.stdout === "string") {
      return rtkRewriteResult(cause.stdout, rtk.executable);
    }
    return { applied: false };
  }
};

const rtkRewriteResult = (
  stdout: string,
  executable: string,
): { applied: boolean; rewrittenCommand?: string; executionCommand?: string } => {
  const rewrittenCommand = stdout.trim();
  return rewrittenCommand
    ? { applied: true, rewrittenCommand, executionCommand: executableRewriteCommand(rewrittenCommand, executable) }
    : { applied: false };
};

const executableRewriteCommand = (command: string, executable: string): string =>
  command.replace(/^rtk(?=\s|$)/, shellQuote(executable));

const readRtkGain = async (rtkExecutable: string, cwd: string): Promise<{ savedTokens: number } | undefined> => {
  try {
    const { stdout } = await execFileAsync(rtkExecutable, ["gain", "--project", "--format", "json"], {
      cwd,
      timeout: 5_000,
      maxBuffer: 5_000_000,
    });
    const parsed = JSON.parse(stdout) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.summary)) {
      return undefined;
    }
    return { savedTokens: nonNegativeInteger(parsed.summary.total_saved) };
  } catch {
    return undefined;
  }
};

const rtkSavedTokenDelta = async (
  rtkExecutable: string,
  cwd: string,
  before: { savedTokens: number } | undefined,
): Promise<number | undefined> => {
  if (!before) {
    return undefined;
  }
  const after = await readRtkGain(rtkExecutable, cwd);
  if (!after) {
    return undefined;
  }
  return Math.max(0, after.savedTokens - before.savedTokens);
};

const withRtkSavings = <T extends { applied: boolean }>(rtk: T, savedTokens: number | undefined): T & { estimatedSavedTokens?: number } => ({
  ...rtk,
  ...(rtk.applied && savedTokens !== undefined ? { estimatedSavedTokens: savedTokens } : {}),
});

const nonNegativeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

const shellCommandArgs = (shell: string, command: string): string[] => {
  const name = basename(shell).toLowerCase();
  if (name === "csh" || name === "tcsh" || name === "fish") {
    return ["-c", command];
  }
  return ["-lc", command];
};

const userShell = (): string | undefined => {
  try {
    return userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
};

const truncate = (value: string, maxBytes: number, label: string): string => {
  const bytes = Buffer.byteLength(value);
  if (bytes <= maxBytes) {
    return value;
  }
  const truncated = sliceBytes(value, 0, maxBytes);
  return `${truncated}\n[${label} truncated: ${bytes} bytes > ${maxBytes} bytes]`;
};

const sliceBytes = (value: string, start: number, end: number): string =>
  Buffer.from(value).subarray(start, end).toString("utf8");

const textResult = (text: string, details?: unknown): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

const byteLength = (value: string): number => Buffer.byteLength(value);

const isTimeoutError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  ("killed" in cause || "signal" in cause) &&
  ((cause as { killed?: unknown }).killed === true || (cause as { signal?: unknown }).signal === "SIGTERM");

const isExecError = (cause: unknown): cause is Error & { code?: number | string; stdout?: string; stderr?: string } =>
  cause instanceof Error && ("stdout" in cause || "stderr" in cause || "code" in cause);

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const runRipgrep = async (args: string[], target: string, cwd: string, signal: AbortSignal): Promise<string[]> => {
  try {
    const result = await execFileAsync("rg", [...args, target], {
      cwd,
      signal,
      maxBuffer: 20_000_000,
    });
    return splitOutput(result.stdout);
  } catch (cause) {
    if (isExecError(cause) && cause.code === 1) {
      return [];
    }
    if (isExecError(cause) && typeof cause.stdout === "string" && cause.stdout.trim().length > 0) {
      return splitOutput(cause.stdout);
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`ripgrep failed: ${message}`);
  }
};

const splitOutput = (output: string): string[] =>
  output
    .trim()
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter(Boolean);

const vcsExcludes = (): string[] =>
  [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"].flatMap((dir) => ["--glob", `!${dir}`]);

const grepArgs = (input: GrepArgs, mode: NonNullable<GrepArgs["output_mode"]>): string[] => {
  const args = ["--hidden", "--max-columns", "500", ...vcsExcludes()];
  if (input.multiline) {
    args.push("-U", "--multiline-dotall");
  }
  if (input.case_insensitive) {
    args.push("-i");
  }
  if (mode === "files") {
    args.push("-l");
  } else if (mode === "count") {
    args.push("-c");
  } else {
    if (input.line_numbers ?? true) {
      args.push("-n");
    }
    if (input.context !== undefined) {
      args.push("-C", String(input.context));
    } else {
      if (input.before_context !== undefined) {
        args.push("-B", String(input.before_context));
      }
      if (input.after_context !== undefined) {
        args.push("-A", String(input.after_context));
      }
    }
  }
  if (input.type) {
    args.push("--type", input.type);
  }
  if (input.glob) {
    for (const pattern of splitGlobPatterns(input.glob)) {
      args.push("--glob", pattern);
    }
  }
  if (input.pattern.startsWith("-")) {
    args.push("-e", input.pattern);
  } else {
    args.push(input.pattern);
  }
  return args;
};

const splitGlobPatterns = (value: string): string[] =>
  value
    .split(/\s+/)
    .flatMap((part) => (part.includes("{") && part.includes("}") ? [part] : part.split(",")))
    .filter(Boolean);

const paginate = <T>(items: T[], limit: number, offset: number): { items: T[]; truncated: boolean; appliedLimit?: number } => {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("head_limit must be a non-negative integer");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  if (limit === 0) {
    return { items: items.slice(offset), truncated: false };
  }
  const selected = items.slice(offset, offset + limit);
  const truncated = items.length - offset > limit;
  return {
    items: selected,
    truncated,
    ...(truncated ? { appliedLimit: limit } : {}),
  };
};

const toWorkspaceRelative = (root: string): ((path: string) => string) => (path) => {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  return relative(root, absolute) || ".";
};

const relativizeGrepLine = (root: string): ((line: string) => string) => (line) => {
  const colon = line.indexOf(":");
  if (colon <= 0) {
    return line;
  }
  const file = line.slice(0, colon);
  const rest = line.slice(colon);
  return `${toWorkspaceRelative(root)(file)}${rest}`;
};

const relativizeCountLine = (root: string): ((line: string) => string) => (line) => {
  const colon = line.lastIndexOf(":");
  if (colon <= 0) {
    return line;
  }
  const file = line.slice(0, colon);
  const rest = line.slice(colon);
  return `${toWorkspaceRelative(root)(file)}${rest}`;
};

const sortPathsByMtime = async (root: string, paths: string[]): Promise<string[]> => {
  const entries = await Promise.all(
    paths.map(async (path) => {
      try {
        const info = await stat(isAbsolute(path) ? path : resolve(root, path));
        return { path, mtimeMs: info.mtimeMs };
      } catch {
        return { path, mtimeMs: 0 };
      }
    }),
  );
  return entries
    .sort((left, right) => {
      const time = right.mtimeMs - left.mtimeMs;
      return time === 0 ? left.path.localeCompare(right.path) : time;
    })
    .map((entry) => entry.path);
};

const formatPaginatedText = <T>(lines: string[], page: { appliedLimit?: number }, offset: number): string => {
  const body = lines.length > 0 ? lines.join("\n") : "No matches found";
  const suffix = formatLimitSuffix(page, offset);
  return suffix ? `${body}\n\n[Showing results with pagination =${suffix}]` : body;
};

const formatLimitSuffix = <T>(page: { appliedLimit?: number }, offset: number): string => {
  const parts = [];
  if (page.appliedLimit !== undefined) {
    parts.push(`limit: ${page.appliedLimit}`);
  }
  if (offset > 0) {
    parts.push(`offset: ${offset}`);
  }
  return parts.length > 0 ? ` ${parts.join(", ")}` : "";
};

const parseCountLines = (lines: string[]): { files: number; matches: number } => {
  let files = 0;
  let matches = 0;
  for (const line of lines) {
    const colon = line.lastIndexOf(":");
    if (colon <= 0) {
      continue;
    }
    const count = Number.parseInt(line.slice(colon + 1), 10);
    if (Number.isFinite(count)) {
      files += 1;
      matches += count;
    }
  }
  return { files, matches };
};
