import { SymphonyError } from "./errors.js";
import { CodexAppServerClient } from "./codex.js";
import { renderPrompt } from "./template.js";
import type {
  AgentRunnerEvent,
  Issue,
  RunStatus,
  ServiceConfig,
  StopReason,
  TrackerClient,
  WorkflowDefinition,
  WorkerResult
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

export interface AgentRunHandle {
  promise: Promise<WorkerResult>;
  stop: (reason: StopReason) => Promise<void>;
}

export class AgentRunner {
  constructor(
    private readonly workflow: WorkflowDefinition,
    private readonly config: ServiceConfig,
    private readonly tracker: TrackerClient,
    private readonly workspaceManager: WorkspaceManager
  ) {}

  start(
    issue: Issue,
    attempt: number | null,
    onEvent: (event: AgentRunnerEvent) => void
  ): AgentRunHandle {
    const abortController = new AbortController();
    let currentSessionStop: (() => Promise<void>) | null = null;
    let stopReason: StopReason | null = null;

    const promise = (async (): Promise<WorkerResult> => {
      let workspacePath = "";
      try {
        const workspace = await this.workspaceManager.ensureWorkspace(issue.identifier);
        workspacePath = workspace.path;
        await this.workspaceManager.cleanupTransientArtifacts(workspacePath);
        await this.workspaceManager.runBeforeRun(workspacePath, issue);

        const codex = new CodexAppServerClient(this.config.codex);
        const session = await codex.startSession(workspacePath);
        currentSessionStop = session.stop;

        let activeIssue = issue;
        let turn = 1;

        while (true) {
          if (abortController.signal.aborted) {
            throw new SymphonyError("canceled", "Run was canceled");
          }

          const prompt =
            turn === 1
              ? await renderPrompt(this.workflow.promptTemplate, activeIssue, attempt)
              : buildContinuationPrompt(activeIssue, turn);

          const result = await session.runTurn(prompt, `${activeIssue.identifier}: ${activeIssue.title}`, onEvent);
          onEvent({
            event: "turn_completed",
            timestamp: new Date(),
            sessionId: `${session.threadId}-${result.turnId}`,
            threadId: session.threadId,
            turnId: result.turnId
          });

          const [refreshedIssue] = await this.tracker.fetchIssueStatesByIds([activeIssue.id]);
          if (!refreshedIssue) {
            break;
          }

          activeIssue = refreshedIssue;
          if (!isStateActive(this.config, activeIssue.state)) {
            break;
          }

          if (turn >= this.config.agent.maxTurns) {
            break;
          }

          turn += 1;
        }

        await session.stop();
        currentSessionStop = null;
        await this.workspaceManager.runAfterRun(workspacePath, issue);
        return {
          ok: true,
          continuationNeeded: true
        };
      } catch (error) {
        const symphonyError =
          error instanceof SymphonyError ? error : new SymphonyError("worker_failed", "Worker failed", error);

        if (currentSessionStop) {
          await currentSessionStop().catch(() => undefined);
        }

        if (workspacePath) {
          await this.workspaceManager.runAfterRun(workspacePath, issue);
        }

        if (abortController.signal.aborted) {
          return {
            ok: false,
            reason: symphonyError.message,
            status: "CanceledByReconciliation",
            retryable: stopReason === "stalled",
            cleanupWorkspace: stopReason === "terminal"
          };
        }

        return {
          ok: false,
          reason: symphonyError.message,
          status: mapErrorToStatus(symphonyError.code),
          retryable: isRetryableError(symphonyError.code)
        };
      }
    })();

    return {
      promise,
      stop: async (reason) => {
        stopReason = reason;
        abortController.abort();
        await currentSessionStop?.().catch(() => undefined);
      }
    };
  }
}

function buildContinuationPrompt(issue: Issue, turn: number): string {
  return [
    "Continue working in this existing thread.",
    `Issue: ${issue.identifier} - ${issue.title}`,
    `Current tracker state: ${issue.state}`,
    `This is continuation turn ${turn}.`,
    "Do not resend the original task summary. Pick up from the current repository and thread state."
  ].join("\n");
}

function mapErrorToStatus(code: string): Exclude<RunStatus, "Succeeded"> {
  switch (code) {
    case "turn_timeout":
      return "TimedOut";
    case "turn_failed":
    case "turn_cancelled":
    case "turn_input_required":
      return "Failed";
    case "canceled":
      return "CanceledByReconciliation";
    default:
      return "Failed";
  }
}

function isRetryableError(code: string): boolean {
  return !["canceled"].includes(code);
}

function isStateActive(config: ServiceConfig, state: string): boolean {
  const normalized = state.toLowerCase();
  return (
    config.tracker.activeStates.some((entry) => entry.toLowerCase() === normalized) &&
    !config.tracker.terminalStates.some((entry) => entry.toLowerCase() === normalized)
  );
}
