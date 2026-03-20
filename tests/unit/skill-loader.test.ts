import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatSkillList, loadSkill, scanSkills } from "../../src/main/skills/skill-loader.js";

describe("skill-loader", () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = path.join(os.tmpdir(), `scorel-skills-${Date.now()}`);
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it("scans valid skills and skips invalid markdown files", () => {
    writeFileSync(
      path.join(skillsDir, "code-review.md"),
      [
        "---",
        "name: code-review",
        "description: Review code carefully",
        'version: "1.0"',
        "---",
        "",
        "# Code Review",
      ].join("\n"),
    );
    writeFileSync(path.join(skillsDir, "invalid.md"), "# Missing frontmatter\n");

    const skills = scanSkills(skillsDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: "code-review",
      description: "Review code carefully",
      version: "1.0",
    });
  });

  it("returns an empty list when the skills directory does not exist", () => {
    rmSync(skillsDir, { recursive: true, force: true });
    expect(scanSkills(skillsDir)).toEqual([]);
  });

  it("loads skill contents, supports list, and reports unknown skills", () => {
    writeFileSync(
      path.join(skillsDir, "test-writer.md"),
      [
        "---",
        "name: test-writer",
        "description: Write focused tests",
        'version: "1.0"',
        "---",
        "",
        "# Test Writer",
      ].join("\n"),
    );

    const skills = scanSkills(skillsDir);
    const loaded = loadSkill(skills, "test-writer");
    const listed = loadSkill(skills, "list");
    const missing = loadSkill(skills, "missing");

    expect(loaded.isError).toBe(false);
    expect(loaded.content).toContain("# Test Writer");
    expect(listed.isError).toBe(false);
    expect(listed.content).toContain("test-writer");
    expect(missing).toEqual({
      isError: true,
      content: 'Unknown skill: missing',
    });
  });

  it("formats the skill list for system prompt injection", () => {
    const formatted = formatSkillList([
      {
        name: "code-review",
        description: "Review code carefully",
        version: "1.0",
        filePath: "/tmp/code-review.md",
      },
      {
        name: "test-writer",
        description: "Write focused tests",
        version: "1.0",
        filePath: "/tmp/test-writer.md",
      },
    ]);

    expect(formatted).toContain("Available skills:");
    expect(formatted).toContain("- code-review: Review code carefully");
    expect(formatted).toContain("Use the load_skill tool");
  });
});
