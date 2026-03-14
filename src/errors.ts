export type SymphonyErrorCode =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "template_parse_error"
  | "template_render_error"
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_tracker_project_slug"
  | "invalid_workspace_path"
  | "invalid_workspace_cwd"
  | "workspace_path_conflict"
  | "workspace_creation_failed"
  | "workspace_hook_failed"
  | "workspace_hook_timeout"
  | "hook_failed"
  | "hook_timeout"
  | "linear_api_request"
  | "linear_api_status"
  | "linear_graphql_errors"
  | "linear_unknown_payload"
  | "linear_missing_end_cursor"
  | "codex_not_found"
  | "response_timeout"
  | "turn_timeout"
  | "port_exit"
  | "response_error"
  | "turn_failed"
  | "turn_cancelled"
  | "turn_input_required"
  | "startup_failed"
  | "missing_codex_command"
  | "canceled"
  | "worker_failed";

export class SymphonyError extends Error {
  public readonly code: SymphonyErrorCode;
  public readonly details?: unknown;

  public constructor(code: SymphonyErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "SymphonyError";
    this.code = code;
    this.details = details;
  }
}

export function isSymphonyError(error: unknown): error is SymphonyError {
  return error instanceof SymphonyError;
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
