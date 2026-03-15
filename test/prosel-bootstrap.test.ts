import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Prosel bootstrap script", () => {
  it("hydrates a workspace from git origin/main", async () => {
    const remoteDir = await createRepo("hello from main");
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "prosel-workspace-"));
    tempDirs.push(workspaceDir);

    await runBootstrap(remoteDir, workspaceDir);

    expect(await readFile(path.join(workspaceDir, "README.md"), "utf8")).toContain("hello from main");
  });

  it("does not overwrite dirty workspace changes", async () => {
    const remoteDir = await createRepo("remote v1");
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "prosel-workspace-"));
    tempDirs.push(workspaceDir);

    await runBootstrap(remoteDir, workspaceDir);
    await writeFile(path.join(workspaceDir, "README.md"), "local dirty change\n");

    await commitChange(remoteDir, "remote v2");
    await runBootstrap(remoteDir, workspaceDir);

    expect(await readFile(path.join(workspaceDir, "README.md"), "utf8")).toContain("local dirty change");
  });
});

async function createRepo(readme: string): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "prosel-remote-"));
  tempDirs.push(repoDir);

  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "Codex"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "codex@example.com"], { cwd: repoDir });
  await writeFile(path.join(repoDir, "README.md"), `${readme}\n`);
  await execFileAsync("git", ["add", "README.md"], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

  return repoDir;
}

async function commitChange(repoDir: string, readme: string): Promise<void> {
  await writeFile(path.join(repoDir, "README.md"), `${readme}\n`);
  await execFileAsync("git", ["add", "README.md"], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "update"], { cwd: repoDir });
}

async function runBootstrap(remoteDir: string, workspaceDir: string): Promise<void> {
  await execFileAsync("bash", ["scripts/prosel-bootstrap-workspace.sh"], {
    cwd: "/Users/chanler/Scorel",
    env: {
      ...process.env,
      PROSEL_GIT_REMOTE: remoteDir,
      PROSEL_GIT_BRANCH: "main",
      SYMPHONY_WORKSPACE: workspaceDir
    }
  });
}
