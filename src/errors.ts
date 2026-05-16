export const ErrorCodes = {
  CLAUDE_NOT_FOUND: "CLAUDE_NOT_FOUND",
  VERSION_TOO_OLD: "VERSION_TOO_OLD",
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  WORKSPACE_NOT_TRUSTED: "WORKSPACE_NOT_TRUSTED",
  URL_TIMEOUT: "URL_TIMEOUT",
  WORKTREE_FAILED: "WORKTREE_FAILED",
  WORKTREE_DIRTY: "WORKTREE_DIRTY",
  NOT_A_WORKTREE_SESSION: "NOT_A_WORKTREE_SESSION",
  MERGE_CONFLICT: "MERGE_CONFLICT",
  WORKTREE_REMOVE_FAILED: "WORKTREE_REMOVE_FAILED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  KILL_FAILED: "KILL_FAILED",
  PLUGIN_INSTALL_FAILED: "PLUGIN_INSTALL_FAILED",
  MCP_ADD_FAILED: "MCP_ADD_FAILED",
  STATE_LOCK_TIMEOUT: "STATE_LOCK_TIMEOUT",
  NOT_A_GIT_REPO: "NOT_A_GIT_REPO",
  INVALID_INPUT: "INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface CrmErrorDetails {
  [k: string]: unknown;
}

export class CrmError extends Error {
  public readonly code: ErrorCode;
  public readonly details: CrmErrorDetails;
  public readonly remediation: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { details?: CrmErrorDetails; remediation?: string } = {},
  ) {
    super(message);
    this.name = "CrmError";
    this.code = code;
    this.details = opts.details ?? {};
    this.remediation = opts.remediation;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      ...(this.remediation ? { remediation: this.remediation } : {}),
    };
  }
}

export function isCrmError(err: unknown): err is CrmError {
  return err instanceof CrmError;
}
