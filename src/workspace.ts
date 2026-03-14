import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { SymphonyError } from "./errors.js";
import { logger } from "./logger.js";
import type { HookConfig, Issue, WorkspaceConfig, WorkspaceInfo } from "./types.js";

export class WorkspaceManager {
  constructor(
    private readonly workspaceConfig: WorkspaceConfig,
    private readonly hooks: HookConfig
  ) {}

  async ensureWorkspace(issueIdentifier: string): Promise<WorkspaceInfo> {
    const workspaceKey = sanitizeWorkspaceKey(issueIdentifier);
    const workspacePath = this.resolveWorkspacePath(workspaceKey);

    await validateWorkspacePath(this.workspaceConfig.root, workspacePath);

    let createdNow = false;
    try {
      const existing = await stat(workspacePath).catch(() => null);
      if (existing?.isDirectory()) {
        createdNow = false;
      } else {
        if (existing) {
          throw new SymphonyError(
            "workspace_path_conflict",
            `Workspace path exists but is not a directory: ${workspacePath}`
          );
        }
        await mkdir(workspacePath, { recursive: true });
        createdNow = true;
      }
    } catch (error) {
      throw new SymphonyError("workspace_creation_failed", "Failed to prepare workspace", error);
    }

    if (createdNow && this.hooks.afterCreate) {
      await this.runHook("after_create", this.hooks.afterCreate, workspacePath, issueIdentifier, true);
    }

    return {
      path: workspacePath,
      workspaceKey,
      createdNow
    };
  }

  async runBeforeRun(workspacePath: string, issue: Issue): Promise<void> {
    if (!this.hooks.beforeRun) {
      return;
    }

    await this.runHook("before_run", this.hooks.beforeRun, workspacePath, issue.identifier, true);
  }

  async runAfterRun(workspacePath: string, issue: Issue): Promise<void> {
    if (!this.hooks.afterRun) {
      return;
    }

    try {
      await this.runHook("after_run", this.hooks.afterRun, workspacePath, issue.identifier, false);
    } catch (error) {
      logger.warn("workspace_hook_failed action=after_run", {
        issue_id: issue.id,
        issue_identifier: issue.identifier,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async removeWorkspace(issueIdentifier: string): Promise<void> {
    const workspacePath = this.resolveWorkspacePath(sanitizeWorkspaceKey(issueIdentifier));
    const exists = await stat(workspacePath).catch(() => null);
    if (!exists?.isDirectory()) {
      return;
    }

    if (this.hooks.beforeRemove) {
      try {
        await this.runHook("before_remove", this.hooks.beforeRemove, workspacePath, issueIdentifier, false);
      } catch (error) {
        logger.warn("workspace_hook_failed action=before_remove", {
          issue_identifier: issueIdentifier,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await rm(workspacePath, { recursive: true, force: true });
  }

  async cleanupTransientArtifacts(workspacePath: string): Promise<void> {
    const transientEntries = new Set(["tmp", ".elixir_ls"]);
    const entries = await readdir(workspacePath).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => transientEntries.has(entry))
        .map((entry) => rm(path.join(workspacePath, entry), { recursive: true, force: true }))
    );
  }

  private resolveWorkspacePath(workspaceKey: string): string {
    return path.resolve(this.workspaceConfig.root, workspaceKey);
  }

  private async runHook(
    hookName: "after_create" | "before_run" | "after_run" | "before_remove",
    script: string,
    cwd: string,
    issueIdentifier: string,
    fatal: boolean
  ): Promise<void> {
    logger.info(`workspace_hook_started action=${hookName}`, {
      issue_identifier: issueIdentifier
    });

    await new Promise<void>((resolve, reject) => {
      const child = spawn("sh", ["-lc", script], {
        cwd,
        env: {
          ...process.env,
          SYMPHONY_WORKSPACE: cwd,
          SYMPHONY_ISSUE_IDENTIFIER: issueIdentifier
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new SymphonyError("workspace_hook_timeout", `${hookName} timed out after ${this.hooks.timeoutMs}ms`));
      }, this.hooks.timeoutMs);

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new SymphonyError("workspace_hook_failed", `${hookName} failed to start`, error));
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new SymphonyError(
            "workspace_hook_failed",
            `${hookName} exited with code ${code}: ${stderr.trim().slice(0, 500)}`
          )
        );
      });
    }).catch((error) => {
      if (!fatal) {
        throw error;
      }
      throw error;
    });
  }
}

export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replaceAll(/[^A-Za-z0-9._-]/g, "_");
}

export async function validateWorkspacePath(root: string, workspacePath: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedWorkspace = path.resolve(workspacePath);
  const relative = path.relative(resolvedRoot, resolvedWorkspace);

  if (relative === "" || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SymphonyError(
      "invalid_workspace_cwd",
      `Workspace path must stay inside workspace root: ${resolvedWorkspace}`
    );
  }
}
