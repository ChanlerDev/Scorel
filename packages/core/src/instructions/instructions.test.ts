import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildInstructionSnapshot, renderSystemPrompt } from "./index.js";

const tempRoot = () => mkdtemp(join(tmpdir(), "scorel-instructions-"));

describe("instruction snapshot", () => {
  it("freezes fixed sections and loads AGENTS.md from project walk plus user scope", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    const repo = join(root, "repo");
    const nested = join(repo, "packages", "app");
    await mkdir(join(home, ".scorel"), { recursive: true });
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(home, ".scorel", "AGENTS.md"), "global rules");
    await writeFile(join(repo, "AGENTS.md"), "repo rules");
    await writeFile(join(repo, "packages", "AGENTS.md"), "package rules");

    const snapshot = await buildInstructionSnapshot({
      cwd: nested,
      homeDir: home,
      now: () => 1_000,
      env: { SHELL: "/bin/zsh" },
    });

    expect(snapshot.sections.map((section) => section.kind)).toEqual([
      "baseline",
      "agents",
      "memory",
      "workspace",
      "environment",
      "time",
    ]);
    const agents = snapshot.sections.find((section) => section.kind === "agents")!;
    expect(agents.sources?.map((source) => source.content)).toEqual(["repo rules", "package rules", "global rules"]);
    expect(agents.renderedBlock).toContain("repo rules");
    expect(agents.renderedBlock).toContain("package rules");
    expect(agents.renderedBlock).toContain("global rules");
    expect(renderSystemPrompt(snapshot)).toContain("Tool results and user messages may include <system-reminder>");
  });
});
