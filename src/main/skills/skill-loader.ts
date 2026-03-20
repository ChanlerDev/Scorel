import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { SkillMeta } from "../../shared/types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type ParsedFrontmatter = {
  name?: string;
  description?: string;
  version?: string;
};

export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  const parsed: ParsedFrontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key === "name" || key === "description" || key === "version") {
      parsed[key] = value;
    }
  }

  return parsed;
}

export function scanSkills(skillsDir: string): SkillMeta[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = readdirSync(skillsDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  const skills: SkillMeta[] = [];

  for (const entry of entries) {
    const filePath = path.join(skillsDir, entry);
    if (!statSync(filePath).isFile()) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (error: unknown) {
      console.warn(`Failed to read skill file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter?.name || !frontmatter.description || !frontmatter.version) {
      console.warn(`Skipping invalid skill file: ${filePath}`);
      continue;
    }

    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      version: frontmatter.version,
      filePath,
    });
  }

  return skills;
}

export function loadSkill(
  skills: SkillMeta[],
  name: string,
): { content: string; isError: boolean } {
  if (name === "list") {
    return {
      content: formatSkillList(skills),
      isError: false,
    };
  }

  const skill = skills.find((entry) => entry.name === name);
  if (!skill) {
    return { content: `Unknown skill: ${name}`, isError: true };
  }

  try {
    return {
      content: readFileSync(skill.filePath, "utf8"),
      isError: false,
    };
  } catch (error: unknown) {
    return {
      content: `Failed to load skill: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

export function formatSkillList(skills: SkillMeta[]): string {
  if (skills.length === 0) {
    return "Available skills:\n- none\n\nUse the load_skill tool with name=\"list\" to confirm availability.";
  }

  const lines = [
    "Available skills:",
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    "",
    'Use the load_skill tool to load one by name, or call it with name="list" to repeat this list.',
  ];

  return lines.join("\n");
}
