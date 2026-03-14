import chokidar, { type FSWatcher } from "chokidar";

import { resolveConfig } from "./config.js";
import { HttpStatusServer } from "./http.js";
import { logger } from "./logger.js";
import { Orchestrator } from "./orchestrator.js";
import type { TrackerClient, WorkflowDefinition } from "./types.js";
import { loadWorkflow } from "./workflow.js";

export class SymphonyService {
  private watcher?: FSWatcher;
  private workflow: WorkflowDefinition | null = null;
  private httpServer?: HttpStatusServer;

  constructor(
    private readonly workflowPath: string | undefined,
    private readonly trackerFactory: (workflow: WorkflowDefinition) => TrackerClient,
    private readonly cliPort?: number
  ) {}

  orchestrator?: Orchestrator;

  async start(): Promise<void> {
    this.workflow = await loadWorkflow(this.workflowPath);
    const config = resolveConfig(this.workflow);
    this.orchestrator = new Orchestrator(this.workflow, config, this.trackerFactory(this.workflow));
    await this.orchestrator.start();
    const port = this.cliPort ?? config.server.port;
    if (port !== undefined) {
      this.httpServer = new HttpStatusServer(this.orchestrator, port);
      await this.httpServer.start();
    }
    this.startWatcher(this.workflow.path);
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    await this.httpServer?.stop();
    await this.orchestrator?.stop();
  }

  private startWatcher(workflowPath: string): void {
    this.watcher = chokidar.watch(workflowPath, {
      ignoreInitial: true
    });

    this.watcher.on("change", () => {
      void this.reloadWorkflow();
    });
  }

  private async reloadWorkflow(): Promise<void> {
    if (!this.orchestrator) {
      return;
    }

    try {
      const workflow = await loadWorkflow(this.workflowPath);
      const config = resolveConfig(workflow);
      this.workflow = workflow;
      this.orchestrator.applyWorkflow(workflow, config, this.trackerFactory(workflow));
    } catch (error) {
      logger.error("workflow_reload_failed action=keep_last_good_config", error);
    }
  }
}
