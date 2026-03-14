import { logger } from "./logger.js";
import type {
  AgentRunnerEvent,
  Issue,
  RetryEntry,
  RuntimeState,
  RunningEntry,
  ServiceConfig,
  StopReason,
  TrackerClient,
  WorkflowDefinition,
  WorkerResult
} from "./types.js";
import { AgentRunner } from "./agent-runner.js";
import { validateDispatchConfig } from "./config.js";
import { WorkspaceManager } from "./workspace.js";

export class Orchestrator {
  private config: ServiceConfig;
  private workflow: WorkflowDefinition;
  private workspaceManager: WorkspaceManager;
  private readonly state: RuntimeState;
  private tickTimer: NodeJS.Timeout | null = null;
  private started = false;
  private tracker: TrackerClient;

  constructor(
    workflow: WorkflowDefinition,
    config: ServiceConfig,
    tracker: TrackerClient
  ) {
    this.workflow = workflow;
    this.config = config;
    this.tracker = tracker;
    this.workspaceManager = new WorkspaceManager(config.workspace, config.hooks);
    this.state = {
      pollIntervalMs: config.polling.intervalMs,
      maxConcurrentAgents: config.agent.maxConcurrentAgents,
      running: new Map(),
      claimed: new Set(),
      retryAttempts: new Map(),
      completed: new Set(),
      codexTotals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        secondsRunning: 0
      },
      codexRateLimits: null
    };
  }

  async start(): Promise<void> {
    validateDispatchConfig(this.config);
    await this.startupTerminalCleanup();
    this.started = true;
    this.scheduleTick(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    for (const retry of this.state.retryAttempts.values()) {
      if (retry.timer) {
        clearTimeout(retry.timer);
      }
    }
    this.state.retryAttempts.clear();

    await Promise.all(
      [...this.state.running.values()].map(async (entry) => {
        await entry.stop?.("shutdown").catch(() => undefined);
      })
    );
  }

  applyWorkflow(workflow: WorkflowDefinition, config: ServiceConfig, tracker?: TrackerClient): void {
    this.workflow = workflow;
    this.config = config;
    if (tracker) {
      this.tracker = tracker;
    }
    this.workspaceManager = new WorkspaceManager(config.workspace, config.hooks);
    this.state.pollIntervalMs = config.polling.intervalMs;
    this.state.maxConcurrentAgents = config.agent.maxConcurrentAgents;
    logger.info("workflow_reloaded action=applied");
    this.scheduleTick(0);
  }

  refreshNow(): void {
    this.scheduleTick(0);
  }

  snapshot(): Record<string, unknown> {
    const running = [...this.state.running.values()].map((entry) => ({
      issue_id: entry.issue.id,
      issue_identifier: entry.issue.identifier,
      state: entry.issue.state,
      session_id: entry.liveSession.sessionId,
      turn_count: entry.liveSession.turnCount,
      last_event: entry.liveSession.lastCodexEvent,
      last_message: entry.liveSession.lastCodexMessage,
      started_at: entry.startedAt.toISOString(),
      last_event_at: entry.liveSession.lastCodexTimestamp?.toISOString() ?? null,
      tokens: {
        input_tokens: entry.liveSession.codexInputTokens,
        output_tokens: entry.liveSession.codexOutputTokens,
        total_tokens: entry.liveSession.codexTotalTokens
      }
    }));

    const retrying = [...this.state.retryAttempts.values()].map((entry) => ({
      issue_id: entry.issueId,
      issue_identifier: entry.identifier,
      attempt: entry.attempt,
      due_at: new Date(entry.dueAtMs).toISOString(),
      error: entry.error
    }));

    return {
      generated_at: new Date().toISOString(),
      counts: {
        running: running.length,
        retrying: retrying.length
      },
      running,
      retrying,
      codex_totals: this.state.codexTotals,
      rate_limits: this.state.codexRateLimits
    };
  }

  private scheduleTick(delayMs: number): void {
    if (!this.started) {
      return;
    }

    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }

    this.tickTimer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.reconcileRunningIssues();
      validateDispatchConfig(this.config);

      const issues = await this.tracker.fetchCandidateIssues();
      for (const issue of sortIssuesForDispatch(issues)) {
        if (this.availableGlobalSlots() <= 0) {
          break;
        }

        if (this.shouldDispatch(issue)) {
          this.dispatchIssue(issue, null);
        }
      }
    } catch (error) {
      logger.error("tick_failed action=dispatch_skipped", error);
    } finally {
      this.scheduleTick(this.state.pollIntervalMs);
    }
  }

  private async reconcileRunningIssues(): Promise<void> {
    await this.reconcileStalledRuns();

    const runningIds = [...this.state.running.keys()];
    if (runningIds.length === 0) {
      return;
    }

    let refreshed: Issue[];
    try {
      refreshed = await this.tracker.fetchIssueStatesByIds(runningIds);
    } catch (error) {
      logger.warn("reconcile_failed action=keep_workers_running", {
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    for (const issue of refreshed) {
      if (this.isTerminalState(issue.state)) {
        await this.terminateRunningIssue(issue.id, "terminal");
        continue;
      }

      if (this.isActiveState(issue.state)) {
        const running = this.state.running.get(issue.id);
        if (running) {
          running.issue = issue;
        }
        continue;
      }

      await this.terminateRunningIssue(issue.id, "inactive");
    }
  }

  private async reconcileStalledRuns(): Promise<void> {
    if (this.config.codex.stallTimeoutMs <= 0) {
      return;
    }

    const now = Date.now();
    for (const [issueId, entry] of this.state.running.entries()) {
      const lastActivityAt = entry.liveSession.lastCodexTimestamp?.getTime() ?? entry.startedAt.getTime();
      if (now - lastActivityAt > this.config.codex.stallTimeoutMs) {
        await this.terminateRunningIssue(issueId, "stalled");
      }
    }
  }

  private async terminateRunningIssue(issueId: string, reason: StopReason): Promise<void> {
    const entry = this.state.running.get(issueId);
    if (!entry || !entry.stop) {
      return;
    }

    await entry.stop(reason);
  }

  private dispatchIssue(issue: Issue, attempt: number | null): void {
    this.state.claimed.add(issue.id);
    const runner = new AgentRunner(this.workflow, this.config, this.tracker, this.workspaceManager);
    const handle = runner.start(issue, attempt, (event) => this.onAgentEvent(issue.id, event));

    const runningEntry: RunningEntry = {
      issue,
      retryAttempt: attempt,
      startedAt: new Date(),
      workspacePath: null,
      stop: async (reason) => {
        await handle.stop(reason);
        const existing = this.state.running.get(issue.id);
        if (existing) {
          existing.liveSession.lastCodexEvent = reason === "stalled" ? "stalled" : "canceled";
        }
      },
      liveSession: {
        sessionId: null,
        threadId: null,
        turnId: null,
        codexAppServerPid: null,
        lastCodexEvent: null,
        lastCodexTimestamp: null,
        lastCodexMessage: null,
        codexInputTokens: 0,
        codexOutputTokens: 0,
        codexTotalTokens: 0,
        lastReportedInputTokens: 0,
        lastReportedOutputTokens: 0,
        lastReportedTotalTokens: 0,
        turnCount: 0
      }
    };

    this.state.running.set(issue.id, runningEntry);

    void handle.promise.then(async (result) => {
      await this.onWorkerExit(issue.id, result);
    });
  }

  private async onWorkerExit(issueId: string, result: WorkerResult): Promise<void> {
    const running = this.state.running.get(issueId);
    if (!running) {
      return;
    }

    this.state.running.delete(issueId);
    this.state.codexTotals.secondsRunning += (Date.now() - running.startedAt.getTime()) / 1000;

    if (result.ok) {
      this.state.completed.add(issueId);
      this.scheduleRetry(issueId, running.issue.identifier, 1, null, true);
      return;
    }

    if (!result.retryable) {
      this.state.claimed.delete(issueId);
      if (result.cleanupWorkspace) {
        await this.workspaceManager.removeWorkspace(running.issue.identifier);
      }
      return;
    }

    const nextAttempt = (running.retryAttempt ?? 0) + 1;
    this.scheduleRetry(issueId, running.issue.identifier, nextAttempt, result.reason, false);
  }

  private scheduleRetry(
    issueId: string,
    identifier: string,
    attempt: number,
    error: string | null,
    continuation: boolean
  ): void {
    const existing = this.state.retryAttempts.get(issueId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    const delayMs = continuation
      ? 1_000
      : Math.min(10_000 * 2 ** Math.max(attempt - 1, 0), this.config.agent.maxRetryBackoffMs);
    const dueAtMs = Date.now() + delayMs;

    const entry: RetryEntry = {
      issueId,
      identifier,
      attempt,
      dueAtMs,
      error,
      continuation
    };

    entry.timer = setTimeout(() => {
      void this.onRetryTimer(issueId);
    }, delayMs);

    this.state.retryAttempts.set(issueId, entry);
  }

  private async onRetryTimer(issueId: string): Promise<void> {
    const retry = this.state.retryAttempts.get(issueId);
    if (!retry) {
      return;
    }
    this.state.retryAttempts.delete(issueId);

    let candidates: Issue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues();
    } catch {
      this.scheduleRetry(issueId, retry.identifier, retry.attempt + 1, "retry poll failed", false);
      return;
    }

    const issue = candidates.find((candidate) => candidate.id === issueId);
    if (!issue) {
      this.state.claimed.delete(issueId);
      return;
    }

    if (!this.shouldDispatch(issue, true)) {
      if (!this.isActiveState(issue.state)) {
        this.state.claimed.delete(issueId);
        return;
      }
      this.scheduleRetry(issueId, retry.identifier, retry.attempt + 1, "no available orchestrator slots", false);
      return;
    }

    this.dispatchIssue(issue, retry.attempt);
  }

  private onAgentEvent(issueId: string, event: AgentRunnerEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) {
      return;
    }

    if (event.sessionId) {
      entry.liveSession.sessionId = event.sessionId;
    }
    if (event.threadId) {
      entry.liveSession.threadId = event.threadId;
    }
    if (event.turnId) {
      entry.liveSession.turnId = event.turnId;
      entry.liveSession.turnCount += 1;
    }
    if (event.codexAppServerPid) {
      entry.liveSession.codexAppServerPid = event.codexAppServerPid;
    }
    entry.liveSession.lastCodexEvent = event.event;
    entry.liveSession.lastCodexTimestamp = event.timestamp;
    entry.liveSession.lastCodexMessage = event.message ?? null;

    if (event.usage) {
      const input = event.usage.inputTokens ?? entry.liveSession.codexInputTokens;
      const output = event.usage.outputTokens ?? entry.liveSession.codexOutputTokens;
      const total = event.usage.totalTokens ?? entry.liveSession.codexTotalTokens;

      this.state.codexTotals.inputTokens += Math.max(input - entry.liveSession.lastReportedInputTokens, 0);
      this.state.codexTotals.outputTokens += Math.max(output - entry.liveSession.lastReportedOutputTokens, 0);
      this.state.codexTotals.totalTokens += Math.max(total - entry.liveSession.lastReportedTotalTokens, 0);

      entry.liveSession.codexInputTokens = input;
      entry.liveSession.codexOutputTokens = output;
      entry.liveSession.codexTotalTokens = total;
      entry.liveSession.lastReportedInputTokens = input;
      entry.liveSession.lastReportedOutputTokens = output;
      entry.liveSession.lastReportedTotalTokens = total;
    }

    if (event.rateLimits) {
      this.state.codexRateLimits = event.rateLimits;
    }
  }

  private shouldDispatch(issue: Issue, allowClaimed = false): boolean {
    if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
      return false;
    }

    if (!this.isActiveState(issue.state) || this.isTerminalState(issue.state)) {
      return false;
    }

    if (this.state.running.has(issue.id)) {
      return false;
    }

    if (!allowClaimed && this.state.claimed.has(issue.id)) {
      return false;
    }

    if (this.availableGlobalSlots() <= 0) {
      return false;
    }

    if (this.availableStateSlots(issue.state) <= 0) {
      return false;
    }

    if (issue.state.toLowerCase() === "todo") {
      const hasBlockingIssue = issue.blocked_by.some((blocker) => !this.isTerminalState(blocker.state ?? ""));
      if (hasBlockingIssue) {
        return false;
      }
    }

    return true;
  }

  private availableGlobalSlots(): number {
    return Math.max(this.state.maxConcurrentAgents - this.state.running.size, 0);
  }

  private availableStateSlots(state: string): number {
    const normalized = state.toLowerCase();
    const configuredCap = this.config.agent.maxConcurrentAgentsByState[normalized];
    const cap = configuredCap ?? this.state.maxConcurrentAgents;
    const runningInState = [...this.state.running.values()].filter(
      (entry) => entry.issue.state.toLowerCase() === normalized
    ).length;
    return Math.max(cap - runningInState, 0);
  }

  private isActiveState(state: string): boolean {
    const normalized = state.toLowerCase();
    return this.config.tracker.activeStates.some((entry) => entry.toLowerCase() === normalized);
  }

  private isTerminalState(state: string): boolean {
    const normalized = state.toLowerCase();
    return this.config.tracker.terminalStates.some((entry) => entry.toLowerCase() === normalized);
  }

  private async startupTerminalCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.tracker.fetchIssuesByStates(this.config.tracker.terminalStates);
      await Promise.all(terminalIssues.map((issue) => this.workspaceManager.removeWorkspace(issue.identifier)));
    } catch (error) {
      logger.warn("startup_terminal_cleanup_failed action=continue", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function sortIssuesForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((left, right) => {
    const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftCreated = left.created_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightCreated = right.created_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return left.identifier.localeCompare(right.identifier);
  });
}
