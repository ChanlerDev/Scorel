import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Type } from "@earendil-works/pi-ai";

import type { SkillIndexEntry } from "@scorel/protocol";

import { defineTool, type AgentTool } from "../tools/index.js";

export type ScanSkillIndexOptions = {
  cwd: string;
  homeDir?: string;
  extensionSkillRoots?: Array<{ path: string; extensionId: string }>;
};

export type SkillIndexDelta = {
  added: SkillIndexEntry[];
  changed: SkillIndexEntry[];
  removed: { name: string; previousPath: string }[];
};

export type CreateSkillToolOptions = {
  getEntry: (name: string) => SkillIndexEntry | undefined;
  listNames: () => string[];
};

export const scanSkillIndex = async (options: ScanSkillIndexOptions): Promise<SkillIndexEntry[]> => {
  const cwd = resolve(options.cwd);
  const homeDir = resolve(options.homeDir ?? homedir());
  const roots = [
    ...projectSkillRoots(cwd, homeDir),
    { path: join(homeDir, ".scorel", "skills"), scope: "user" as const, priority: 0 },
    ...(options.extensionSkillRoots ?? []).map((root, index) => ({
      path: root.path,
      scope: "extension" as const,
      priority: -100 - index,
    })),
  ];
  const byName = new Map<string, SkillIndexEntry>();

  for (const root of roots) {
    let children: string[];
    try {
      children = await readdir(root.path);
    } catch (cause) {
      if (isNodeErrorCode(cause, "ENOENT") || isNodeErrorCode(cause, "ENOTDIR")) {
        continue;
      }
      throw cause;
    }
    for (const child of children.sort()) {
      const entry = await readSkillEntry({
        name: child,
        skillPath: join(root.path, child, "SKILL.md"),
        scope: root.scope,
        priority: root.priority,
      });
      if (!entry || byName.has(entry.name)) {
        continue;
      }
      byName.set(entry.name, entry);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const diffSkillIndex = (
  previous: Record<string, SkillIndexEntry>,
  nextEntries: SkillIndexEntry[],
): SkillIndexDelta => {
  const next = Object.fromEntries(nextEntries.map((entry) => [entry.name, entry]));
  const added: SkillIndexEntry[] = [];
  const changed: SkillIndexEntry[] = [];
  const removed: { name: string; previousPath: string }[] = [];

  for (const entry of nextEntries) {
    const old = previous[entry.name];
    if (!old) {
      added.push(entry);
    } else if (
      old.path !== entry.path ||
      old.contentHash !== entry.contentHash ||
      old.mtimeMs !== entry.mtimeMs ||
      old.size !== entry.size
    ) {
      changed.push(entry);
    }
  }
  for (const old of Object.values(previous)) {
    if (!next[old.name]) {
      removed.push({ name: old.name, previousPath: old.path });
    }
  }

  return { added, changed, removed };
};

export const hasSkillIndexDelta = (delta: SkillIndexDelta): boolean =>
  delta.added.length > 0 || delta.changed.length > 0 || delta.removed.length > 0;

export const renderSkillListing = (entries: SkillIndexEntry[]): string => {
  if (entries.length === 0) {
    return "No skills are currently available for the Skill tool.";
  }
  return [
    "The following skills are available for use with the Skill tool:",
    "",
    ...entries.map((entry) => `- ${entry.name}: ${entry.description}`),
  ].join("\n");
};

export const renderSkillDelta = (delta: SkillIndexDelta): string => {
  const lines = ["Skill updates detected:"];
  if (delta.added.length > 0) {
    lines.push("", "Added:", ...delta.added.map((entry) => `- ${entry.name}: ${entry.description}`));
  }
  if (delta.changed.length > 0) {
    lines.push("", "Changed:", ...delta.changed.map((entry) => `- ${entry.name}: ${entry.description}`));
  }
  if (delta.removed.length > 0) {
    lines.push("", "Removed:", ...delta.removed.map((entry) => `- ${entry.name}`));
  }
  return lines.join("\n");
};

export const createSkillTool = (options: CreateSkillToolOptions): AgentTool =>
  defineTool({
    name: "Skill",
    description: "Load the full SKILL.md instructions for an available session-indexed skill by name.",
    parameters: Type.Object({
      name: Type.String(),
      args: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const input = parseSkillArgs(args);
      const entry = options.getEntry(input.name);
      if (!entry) {
        throw new Error(`Unknown skill: ${input.name}. Available skills: ${options.listNames().join(", ") || "none"}`);
      }
      const content = await readFile(entry.path, "utf8");
      return {
        content: [{ type: "text", text: content }],
        details: {
          skill: {
            name: entry.name,
            path: entry.path,
            scope: entry.scope,
            args: input.args,
          },
        },
      };
    },
  });

const projectSkillRoots = (cwd: string, homeDir: string): Array<{ path: string; scope: "project"; priority: number }> => {
  const roots: string[] = [];
  const gitRoot = findGitRoot(cwd);
  const stopAt = gitRoot ?? homeDir;
  let current = cwd;

  while (true) {
    if (current !== homeDir) {
      roots.push(join(current, ".scorel", "skills"));
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

  return roots.map((path, index) => ({ path, scope: "project", priority: 100 + index }));
};

const readSkillEntry = async (options: {
  name: string;
  skillPath: string;
  scope: "user" | "project" | "extension";
  priority: number;
}): Promise<SkillIndexEntry | undefined> => {
  let fileStat;
  let content: string;
  try {
    [fileStat, content] = await Promise.all([stat(options.skillPath), readFile(options.skillPath, "utf8")]);
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT") || isNodeErrorCode(cause, "ENOTDIR")) {
      return undefined;
    }
    throw cause;
  }
  const parsed = parseSkillMetadata(content);
  const description = parsed.description ?? firstParagraph(content);
  if (!description) {
    return undefined;
  }
  return {
    name: options.name,
    path: options.skillPath,
    scope: options.scope,
    description,
    ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    contentHash: createHash("sha256").update(content).digest("hex"),
    priority: options.priority,
  };
};

const parseSkillMetadata = (content: string): { displayName?: string; description?: string } => {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    return {};
  }
  const frontmatter = content.slice(4, end).split(/\r?\n/);
  const metadata: { displayName?: string; description?: string } = {};
  for (const line of frontmatter) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const value = match[2]?.replace(/^["']|["']$/g, "").trim();
    if (!value) {
      continue;
    }
    if (match[1] === "name") {
      metadata.displayName = value;
    } else if (match[1] === "description") {
      metadata.description = value;
    }
  }
  return metadata;
};

const firstParagraph = (content: string): string | undefined => {
  const frontmatterEnd = content.startsWith("---\n") ? content.indexOf("\n---", 4) : -1;
  const body = frontmatterEnd >= 0 ? content.slice(frontmatterEnd + 4) : content;
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim().replace(/^#\s+.+\n?/, "").trim())
    .find((part) => part.length > 0);
};

const parseSkillArgs = (args: unknown): { name: string; args?: string } => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Skill args must be an object");
  }
  const input = args as { name?: unknown; args?: unknown };
  if (typeof input.name !== "string" || input.name.length === 0) {
    throw new Error("Skill name must be a non-empty string");
  }
  return {
    name: input.name,
    ...(typeof input.args === "string" ? { args: input.args } : {}),
  };
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

const isNodeErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
