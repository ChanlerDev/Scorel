// Scorel defaults and limits

export const NANOID_LENGTH = 21;

// Tool output truncation limits (Runner level)
export const BASH_MAX_OUTPUT = 32_000;
export const READ_FILE_MAX_OUTPUT = 64_000;
export const WRITE_FILE_MAX_OUTPUT = 500;
export const EDIT_FILE_MAX_OUTPUT = 2_000;

// Compact
export const MICRO_COMPACT_KEEP_RECENT = 3; // turns
export const MANUAL_COMPACT_MAX_INPUT = 100_000; // chars
export const MANUAL_COMPACT_TOOL_RESULT_PREVIEW = 500; // chars

// Streaming
export const ABORT_TIMEOUT_MS = 500;

// Runner
export const RUNNER_HEARTBEAT_INTERVAL_MS = 2_000;
export const RUNNER_ABORT_GRACE_MS = 5_000;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const MAX_TOOL_TIMEOUT_MS = 300_000;

// FTS
export const FTS_CONTENT_MAX_CHARS = 2_000;

// Auto compact
export const AUTO_COMPACT_DEFAULT_THRESHOLD = 0.8;

// Subagent
export const SUBAGENT_MAX_DEPTH = 1;
export const SUBAGENT_DEFAULT_MAX_TURNS = 20;

// DB
export const DB_FILENAME = "scorel.db";
export const EVENTLOG_FILENAME = "events.jsonl";
export const EVENTLOG_VERSION = "scorel.eventlog.v0";
export const EXPORT_VERSION = "scorel.export.v0";
