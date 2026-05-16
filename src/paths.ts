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
