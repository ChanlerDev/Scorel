import type { ClientId, EventId, ProjectId, Seq, SessionId } from "./ids.js";
import type { ScorelMessage, StopReason, Usage } from "./messages.js";

export type CreateSessionMeta = {
  projectId: ProjectId;
  title?: string;
  model?: string;
  modelSelection?: ModelSelectionInput;
};

export type SessionMeta = {
  projectId: ProjectId;
  title?: string;
  model?: string;
  selectedModel?: SelectedModelSummary;
  createdAt?: number;
  updatedAt?: number;
};

export type ModelRole = "primary" | "standard" | "auxiliary";

export type ModelSelectionInput = {
  modelId?: string;
  role?: ModelRole;
};

export type AvailableModelSummary = {
  modelId: string;
  providerModelId: string;
  providerId: string;
  provider: string;
  id: string;
  displayName: string;
  roles: ModelRole[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
};

export type ProviderConnectionSummary = {
  providerId: string;
  type: "builtin" | "custom";
  provider: string;
  api?: "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";
  baseUrl?: string;
  apiKeyEnv?: string;
  credentialSource: "env" | "direct";
  credentialStatus: "available" | "missing";
};

export type ProviderModelSummary = {
  providerModelId: string;
  providerId: string;
  provider: string;
  id: string;
  displayName: string;
  availableModelIds: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
};

export type ProviderCatalogModelSummary = {
  id: string;
  displayName: string;
};

export type UpsertModelProfileInput = {
  projectId?: ProjectId;
  providerId?: string;
  providerType?: "builtin" | "custom";
  provider?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  api?: "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";
  baseUrl?: string;
  modelId?: string;
  providerModelId?: string;
  providerModelKey?: string;
  availableModelId?: string;
  addToAvailable?: boolean;
  removeAvailableModelId?: string;
  displayName?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
  roles?: Partial<Record<ModelRole, string>>;
};

export type RemoveModelProviderInput = {
  projectId?: ProjectId;
  providerId: string;
};

export type MemorySettings = {
  enabled: boolean;
  daily: boolean;
  sessionMemory: boolean;
  autoDream: boolean;
  promoteRoot: boolean;
  dreamIdleMinutes: number;
  autoCompactThreshold: number;
};

export type RuntimeSettings = {
  tokenSavingRtk: boolean;
  rtkAvailable: boolean;
  rtkExecutable?: string;
  rtkVersion?: string;
  installStatus?: "idle" | "installed" | "failed";
  installMessage?: string;
  estimatedOutputTokens: number;
  estimatedSavedTokens: number;
};

export type MemoryStatus = {
  projectId: ProjectId;
  dirty: boolean;
  running: boolean;
  lastDailyAppendAt?: number;
  lastDailyPath?: string;
  scheduledFor?: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastFailure?: {
    at: number;
    message: string;
  };
  lastProjectMemoryUpdateAt?: number;
  lastRootMemoryUpdateAt?: number;
};

export type UpsertMemorySettingsInput = Partial<MemorySettings> & {
  projectId?: ProjectId;
};

export type UpsertRuntimeSettingsInput = {
  projectId?: ProjectId;
  tokenSavingRtk?: boolean;
};

export type ExtensionSettings = {
  extensionId: string;
  enabled: boolean;
  kind: "im";
  config: Record<string, string | number | boolean>;
  active: boolean;
};

export type UpsertExtensionSettingsInput = {
  extensionId: string;
  enabled?: boolean;
  kind?: "im";
  config?: Record<string, string | number | boolean | undefined>;
};

export type SelectedModelSummary = {
  modelId: string;
  role?: ModelRole;
  providerId: string;
  provider: string;
  id: string;
  displayName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsImageInput?: boolean;
};

export type PersistentEventBase = {
  id: EventId;
  parentId: EventId | null;
  seq: Seq;
  sessionId: SessionId;
  clientId: ClientId;
  ts: number;
};

export type SessionHeaderEvent = PersistentEventBase & {
  type: "session_header";
  protocolVersion: 5;
  meta: SessionMeta;
};

export type UserMessageEvent = PersistentEventBase & {
  type: "user_message";
  message: ScorelMessage & { role: "user" };
};

export type AssistantMessageEvent = PersistentEventBase & {
  type: "assistant_message";
  message: ScorelMessage & { role: "assistant" };
};

export type ToolResultEvent = PersistentEventBase & {
  type: "tool_result";
  message: ScorelMessage & { role: "tool_result" };
};

export type SessionTitleUpdatedEvent = PersistentEventBase & {
  type: "session_title_updated";
  title: string;
  source: "model" | "user";
  model?: SelectedModelSummary;
  derivedFrom?: {
    eventId: EventId;
    seq: Seq;
  };
};

export type InstructionSectionKind = "baseline" | "agents" | "memory" | "workspace" | "environment" | "time";

export type InstructionSource = {
  sourceType: "builtin" | "agents_md" | "memory";
  path?: string;
  scope?: "global_user" | "project";
  priority?: number;
  content?: string;
};

export type InstructionSection = {
  kind: InstructionSectionKind;
  frozenAt: number;
  sources?: InstructionSource[];
  renderedBlock: string;
  data?: Record<string, unknown>;
};

export type InstructionSnapshot = {
  version: 1;
  cwd: string;
  sections: InstructionSection[];
};

export type InstructionSnapshotEvent = PersistentEventBase & {
  type: "instruction_snapshot";
  snapshot: InstructionSnapshot;
};

export type HarnessItemKind =
  | "attachment"
  | "skill_listing"
  | "skill_delta"
  | "memory"
  | "channel_context"
  | "date_change"
  | "steer"
  | "runtime_notice";

export type HarnessItemOrigin = "user" | "system" | "tool" | "skill";

export type HarnessItem = {
  kind: HarnessItemKind;
  origin: HarnessItemOrigin;
  content: string;
  visibility: "display" | "hidden" | "compact";
  data?: Record<string, unknown>;
};

export type HarnessItemEvent = PersistentEventBase & {
  type: "harness_item";
  item: HarnessItem;
};

export type CompactEvent = PersistentEventBase & {
  type: "compact";
  summary: string;
  compactedThrough: EventId;
  tokensBefore: number;
  tokensAfter: number;
  retainedEventCount: number;
};

export type ContextControlEvent = PersistentEventBase & {
  type: "context_control";
  operation: "hide_user_turn";
  anchorUserEventId: EventId;
  throughEventId: EventId;
  actor: "agent" | "user" | "system";
  reason?: string;
};

export type QueueName = "follow_up" | "steer";

export type QueueItem = {
  id: string;
  content: ScorelMessage["content"];
  createdAt: number;
  updatedAt: number;
  clientId: ClientId;
  data?: Record<string, unknown>;
};

export type QueueUpdateEvent = PersistentEventBase & {
  type: "queue_update";
  queue: QueueName;
  operation: "rewrite";
  items: QueueItem[];
  anchorEventId: EventId | null;
};

export type SkillIndexEntry = {
  name: string;
  path: string;
  scope: "user" | "project" | "extension";
  description: string;
  displayName?: string;
  mtimeMs: number;
  size: number;
  contentHash: string;
  priority: number;
  shadowed?: boolean;
  diagnostics?: string[];
};

export type SkillIndexSnapshotEvent = PersistentEventBase & {
  type: "skill_index_snapshot";
  anchorEventId: EventId | null;
  entries: SkillIndexEntry[];
};

export type SkillIndexDeltaEvent = PersistentEventBase & {
  type: "skill_index_delta";
  anchorEventId: EventId | null;
  added: SkillIndexEntry[];
  changed: SkillIndexEntry[];
  removed: { name: string; previousPath: string }[];
};

export type PersistentEvent =
  | SessionHeaderEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolResultEvent
  | SessionTitleUpdatedEvent
  | InstructionSnapshotEvent
  | HarnessItemEvent
  | CompactEvent
  | ContextControlEvent
  | QueueUpdateEvent
  | SkillIndexSnapshotEvent
  | SkillIndexDeltaEvent;

export type TransientEventBase = {
  seq: Seq;
  sessionId: SessionId;
  clientId: ClientId;
  ts: number;
};

export type TurnStartEvent = TransientEventBase & {
  type: "turn_start";
  turnIndex: number;
};

export type TurnEndEvent = TransientEventBase & {
  type: "turn_end";
  turnIndex: number;
  usage?: Usage;
  stopReason?: StopReason;
};

export type MessageStartEvent = TransientEventBase & {
  type: "message_start";
  eventId: EventId;
  parentId: EventId | null;
  role: "assistant" | "tool_result";
  model?: string;
};

export type MessageEndEvent = TransientEventBase & {
  type: "message_end";
  eventId: EventId;
  stopReason?: StopReason;
  usage?: Usage;
};

export type TextDeltaEvent = TransientEventBase & {
  type: "text_delta";
  eventId: EventId;
  delta: string;
};

export type ThinkingDeltaEvent = TransientEventBase & {
  type: "thinking_delta";
  eventId: EventId;
  delta: string;
};

export type ErrorEvent = TransientEventBase & {
  type: "error";
  code: ErrorCode;
  message: string;
  requestId?: string;
};

export type TransientEvent =
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageEndEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ErrorEvent;

export type ScorelEvent = PersistentEvent | TransientEvent;

export type ErrorCode =
  | "session_not_found"
  | "project_not_found"
  | "project_has_sessions"
  | "filesystem_error"
  | "runtime_busy"
  | "invalid_request"
  | "auth_failed"
  | "protocol_mismatch"
  | "resync_failed"
  | "invalid_event_id"
  | "conflict"
  | "transport_closed"
  | "internal_error";

export type DaemonStatus = {
  running: boolean;
  model?: string;
  activeClients: ClientId[];
  sessionCount: number;
  uptimeMs: number;
};

export type SessionSummary = {
  sessionId: SessionId;
  projectId: ProjectId;
  title?: string;
  model?: string;
  updatedAt: number;
  currentSeq: Seq;
};

export type HostProject = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;
  createdAt: number;
  updatedAt: number;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory";
};

export type DirectoryListing = {
  path: string;
  parentPath?: string;
  entries: DirectoryEntry[];
};
