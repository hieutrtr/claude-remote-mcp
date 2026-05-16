import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { auditLogPath } from "./paths.js";

export type AuditEvent =
  | "session_spawned"
  | "session_spawn_failed"
  | "session_stopped"
  | "session_died"
  | "plugin_installed"
  | "mcp_server_installed"
  | "session_merged_back"
  | "preflight_run";

export interface AuditPayload {
  [k: string]: unknown;
}

export function appendAudit(event: AuditEvent, data: AuditPayload = {}): void {
  const file = auditLogPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    ts: new Date().toISOString(),
    event,
    by_orchestrator_pid: process.ppid ?? null,
    by_mcp_pid: process.pid,
    data,
  };
  appendFileSync(file, JSON.stringify(record) + "\n", { encoding: "utf8" });
}
