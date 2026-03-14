export interface IssueBlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: IssueBlockerRef[];
  created_at: Date | null;
  updated_at: Date | null;
}

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  promptTemplate: string;
  path: string;
}

export interface TrackerConfig {
  kind: "linear";
  endpoint: string;
  apiKey: string | null;
  projectSlug: string | null;
  activeStates: string[];
  terminalStates: string[];
}

export interface PollingConfig {
  intervalMs: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HookConfig {
  afterCreate: string | null;
  beforeRun: string | null;
  afterRun: string | null;
  beforeRemove: string | null;
  timeoutMs: number;
}

export interface AgentConfig {
  maxConcurrentAgents: number;
  maxRetryBackoffMs: number;
  maxTurns: number;
  maxConcurrentAgentsByState: Record<string, number>;
}

export interface CodexConfig {
  command: string;
  approvalPolicy?: string | undefined;
  threadSandbox?: string | undefined;
  turnSandboxPolicy?: Record<string, unknown> | undefined;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
}

export interface ServerConfig {
  port?: number | undefined;
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HookConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  server: ServerConfig;
}

export interface WorkspaceInfo {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

export interface LiveSession {
  sessionId: string | null;
  threadId: string | null;
  turnId: string | null;
  codexAppServerPid: string | null;
  lastCodexEvent: string | null;
  lastCodexTimestamp: Date | null;
  lastCodexMessage: string | null;
  codexInputTokens: number;
  codexOutputTokens: number;
  codexTotalTokens: number;
  lastReportedInputTokens: number;
  lastReportedOutputTokens: number;
  lastReportedTotalTokens: number;
  turnCount: number;
}

export interface RunAttempt {
  issueId: string;
  issueIdentifier: string;
  attempt: number | null;
  workspacePath: string;
  startedAt: Date;
  status: RunStatus;
  error?: string;
}

export type RunStatus =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgentProcess"
  | "InitializingSession"
  | "StreamingTurn"
  | "Finishing"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "CanceledByReconciliation";

export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  error: string | null;
  continuation: boolean;
  timer?: NodeJS.Timeout;
}

export interface RunningEntry {
  issue: Issue;
  retryAttempt: number | null;
  startedAt: Date;
  liveSession: LiveSession;
  workspacePath: string | null;
  stop?: (reason: StopReason) => Promise<void>;
}

export interface CodexTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}

export interface RuntimeState {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codexTotals: CodexTotals;
  codexRateLimits: Record<string, unknown> | null;
}

export interface WorkerSuccess {
  ok: true;
  continuationNeeded: boolean;
}

export interface WorkerFailure {
  ok: false;
  reason: string;
  status: Exclude<RunStatus, "Succeeded">;
  retryable: boolean;
  cleanupWorkspace?: boolean;
}

export type WorkerResult = WorkerSuccess | WorkerFailure;

export interface AgentRunnerEvent {
  event: string;
  timestamp: Date;
  codexAppServerPid?: string | null | undefined;
  sessionId?: string | null | undefined;
  threadId?: string | null | undefined;
  turnId?: string | null | undefined;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  } | undefined;
  rateLimits?: Record<string, unknown> | null | undefined;
  message?: string | null | undefined;
  raw?: unknown | undefined;
}

export type StopReason = "terminal" | "inactive" | "stalled" | "shutdown";

export interface TrackerClient {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]>;
}
