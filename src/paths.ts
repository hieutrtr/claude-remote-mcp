import { homedir } from "node:os";
import path from "node:path";

export function dataHome(): string {
  const override = process.env["CLAUDE_REMOTE_MCP_HOME"];
  if (override && override.length > 0) return override;
  const xdg = process.env["XDG_STATE_HOME"];
  if (xdg && xdg.length > 0) {
    return path.join(xdg, "claude-remote-mcp");
  }
  return path.join(homedir(), ".claude-remote-mcp");
}

export function stateFilePath(): string {
  return path.join(dataHome(), "state.json");
}

export function auditLogPath(): string {
  return path.join(dataHome(), "audit.log");
}

export function childLogPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dataHome(), "logs", `${safe}.log`);
}

export function lockFilePath(): string {
  return `${stateFilePath()}.lock`;
}

/**
 * The user's project root, as exposed by Claude Code via the
 * CLAUDE_PROJECT_DIR env var (same value passed to hooks). Used so that
 * relative `folder` inputs resolve against the orchestrator's actual project
 * directory rather than the MCP server process cwd (which, when the plugin
 * is installed, is the plugin install directory itself — definitely NOT
 * where the user wants worktrees / mkdir to happen).
 */
export function orchestratorProjectDir(): string {
  const fromEnv = process.env["CLAUDE_PROJECT_DIR"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return process.cwd();
}
