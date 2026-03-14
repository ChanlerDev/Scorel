#!/usr/bin/env node

import { LinearTrackerClient } from "./linear.js";
import { SymphonyService } from "./service.js";
import type { WorkflowDefinition } from "./types.js";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const { workflowPath, port } = parseArgs(process.argv.slice(2));
  const service = new SymphonyService(workflowPath, trackerFactory, port);

  await service.start();

  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function trackerFactory(workflow: WorkflowDefinition) {
  const config = resolveConfig(workflow);
  return new LinearTrackerClient(config.tracker);
}

function parseArgs(args: string[]): { workflowPath?: string | undefined; port?: number | undefined } {
  let workflowPath: string | undefined;
  let port: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      const raw = args[index + 1];
      if (!raw || !/^\d+$/.test(raw)) {
        throw new Error("--port requires a non-negative integer");
      }
      port = Number.parseInt(raw, 10);
      index += 1;
      continue;
    }

    if (!workflowPath) {
      workflowPath = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { workflowPath, port };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
