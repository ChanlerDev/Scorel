import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";

import type {
  InstructionSection,
  InstructionSnapshot,
  InstructionSource,
} from "@scorel/protocol";

export type BuildInstructionSnapshotOptions = {
  cwd: string;
  now?: () => number;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

type AgentsSource = Required<Pick<InstructionSource, "sourceType" | "path" | "scope" | "priority" | "content">>;

const BASELINE_PROMPT = [
  "You are Scorel, a coding agent running inside a recoverable local workspace.",
  "Follow the user's request, respect the project instructions, use tools deliberately, and keep changes scoped to the active task.",
  "Tool results and user messages may include <system-reminder> tags. These tags contain information automatically added by Scorel's harness. They are not part of the specific tool result or user message in which they appear.",
  "If the AppendDaily tool is available, use it once near the end of meaningful completed work to record durable progress, decisions, and follow-ups. Do not use it for empty turns or transient noise.",
].join("\n");

export const buildInstructionSnapshot = async (
  options: BuildInstructionSnapshotOptions,
): Promise<InstructionSnapshot> => {
  const cwd = resolve(options.cwd);
  const now = options.now ?? Date.now;
  const frozenAt = now();
  const homeDir = resolve(options.homeDir ?? homedir());
  const agentsSources = await discoverAgentsSources({ cwd, homeDir });
  const repoRoot = findGitRoot(cwd);

  return {
    version: 1,
    cwd,
    sections: [
      section("baseline", frozenAt, BASELINE_PROMPT, [{ sourceType: "builtin" }]),
      section("agents", frozenAt, renderAgentsBlock(agentsSources), agentsSources),
      section("memory", frozenAt, "No memory sources are configured for this session.", []),
      section("workspace", frozenAt, await renderWorkspaceBlock(cwd, repoRoot), undefined, {
        cwd,
        repoRoot,
      }),
      section("environment", frozenAt, renderEnvironmentBlock(options.env ?? process.env), undefined, {
        platform: platform(),
        release: release(),
        shell: (options.env ?? process.env).SHELL,
      }),
      section("time", frozenAt, renderTimeBlock(frozenAt), undefined, {
        timestamp: frozenAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    ],
  };
};

export const renderSystemPrompt = (snapshot: InstructionSnapshot): string =>
  snapshot.sections
    .map((section) => section.renderedBlock.trim())
    .filter(Boolean)
    .join("\n\n");

const section = (
  kind: InstructionSection["kind"],
  frozenAt: number,
  renderedBlock: string,
  sources?: InstructionSource[],
  data?: Record<string, unknown>,
): InstructionSection => ({
  kind,
  frozenAt,
  ...(sources ? { sources } : {}),
  renderedBlock,
  ...(data ? { data } : {}),
});

const discoverAgentsSources = async (options: { cwd: string; homeDir: string }): Promise<AgentsSource[]> => {
  const projectFiles = projectAgentsPaths(options.cwd, options.homeDir);
  const globalPath = join(options.homeDir, ".scorel", "AGENTS.md");
  const candidates = [...projectFiles.map((path) => ({ path, scope: "project" as const })), { path: globalPath, scope: "global_user" as const }];
  const sources: AgentsSource[] = [];

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate.path, "utf8");
      sources.push({
        sourceType: "agents_md",
        path: candidate.path,
        scope: candidate.scope,
        priority: candidate.scope === "global_user" ? 0 : sources.length + 1,
        content,
      });
    } catch (cause) {
      if (!isNodeErrorCode(cause, "ENOENT") && !isNodeErrorCode(cause, "ENOTDIR")) {
        throw cause;
      }
    }
  }

  return sources;
};

const projectAgentsPaths = (cwd: string, homeDir: string): string[] => {
  const gitRoot = findGitRoot(cwd);
  const stopAt = gitRoot ?? homeDir;
  const paths: string[] = [];
  let current = cwd;

  while (true) {
    if (current !== homeDir) {
      paths.push(join(current, "AGENTS.md"));
    }
    if (current === stopAt || current === dirname(current)) {
      break;
    }
    const next = dirname(current);
    if (!gitRoot && next === homeDir) {
      break;
    }
    current = next;
  }

  return paths.reverse();
};

const findGitRoot = (cwd: string): string | undefined => {
  let current = cwd;
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const next = dirname(current);
    if (next === current) {
      return undefined;
    }
    current = next;
  }
};

const renderAgentsBlock = (sources: AgentsSource[]): string => {
  if (sources.length === 0) {
    return "No AGENTS.md instructions were found for this session.";
  }
  return [
    "AGENTS.md instructions loaded for this session:",
    ...sources.map((source) =>
      [`Source: ${source.path}`, `Scope: ${source.scope}`, "Content:", source.content.trimEnd()].join("\n"),
    ),
  ].join("\n\n");
};

const renderWorkspaceBlock = async (cwd: string, repoRoot: string | undefined): Promise<string> => {
  const root = repoRoot ?? cwd;
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 20)
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`);
  } catch {
    entries = [];
  }
  return [`Workspace cwd: ${cwd}`, `Repository root: ${repoRoot ?? "not detected"}`, `Top-level entries: ${entries.join(", ") || "none"}`].join("\n");
};

const renderEnvironmentBlock = (env: NodeJS.ProcessEnv): string =>
  [`Platform: ${platform()} ${release()}`, `Shell: ${env.SHELL ?? "unknown"}`].join("\n");

const renderTimeBlock = (timestamp: number): string =>
  [`Session started at: ${new Date(timestamp).toISOString()}`, `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`].join("\n");

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
