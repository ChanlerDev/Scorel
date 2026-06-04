import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSkillTool, diffSkillIndex, scanSkillIndex } from "./index.js";

const tempRoot = () => mkdtemp(join(tmpdir(), "scorel-skills-"));

describe("skills", () => {
  it("loads user and project skills using directory names as routing keys", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const repo = join(root, "repo");
    const nested = join(repo, "packages", "app");
    await mkdir(join(home, ".scorel", "skills", "commit"), { recursive: true });
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".scorel", "skills", "verify"), { recursive: true });
    await mkdir(join(nested, ".scorel", "skills", "commit"), { recursive: true });
    await writeFile(join(home, ".scorel", "skills", "commit", "SKILL.md"), "---\nname: Pretty Commit\ndescription: user commit\n---\n");
    await writeFile(join(repo, ".scorel", "skills", "verify", "SKILL.md"), "# Verify\n\nRun checks.");
    await writeFile(
      join(nested, ".scorel", "skills", "commit", "SKILL.md"),
      "---\nname: Project Commit\ndescription: project commit\n---\n",
    );

    const entries = await scanSkillIndex({ cwd: nested, homeDir: home });

    expect(entries.map((entry) => [entry.name, entry.description, entry.displayName, entry.scope])).toEqual([
      ["commit", "project commit", "Project Commit", "project"],
      ["verify", "Run checks.", undefined, "project"],
    ]);
  });

  it("diffs skill index snapshots and loads Skill tool content from the indexed path", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const repo = join(root, "repo");
    await mkdir(join(repo, ".scorel", "skills", "verify"), { recursive: true });
    await writeFile(join(repo, ".scorel", "skills", "verify", "SKILL.md"), "---\ndescription: verify repo\n---\nFull skill body.");
    const entries = await scanSkillIndex({ cwd: repo, homeDir: home });
    const delta = diffSkillIndex({}, entries);
    const index = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    const tool = createSkillTool({
      getEntry: (name) => index[name],
      listNames: () => Object.keys(index),
    });

    expect(delta.added.map((entry) => entry.name)).toEqual(["verify"]);
    await expect(tool.execute("call_1", { name: "missing" }, new AbortController().signal, () => undefined)).rejects.toThrow(
      "Unknown skill: missing",
    );
    await expect(tool.execute("call_2", { name: "verify" }, new AbortController().signal, () => undefined)).resolves.toMatchObject({
      content: [{ type: "text", text: "---\ndescription: verify repo\n---\nFull skill body." }],
      details: { skill: { name: "verify" } },
    });
  });
});
