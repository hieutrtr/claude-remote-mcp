import { orchestratorProjectDir } from "../paths.js";
import type { PreflightCheck, PreflightResult } from "../types.js";
import * as authenticated from "./authenticated.js";
import * as claudePresent from "./claudePresent.js";
import * as claudeVersion from "./claudeVersion.js";
import * as outboundHttps from "./outboundHttps.js";
import * as platformDetach from "./platformDetach.js";
import * as stateWritable from "./stateWritable.js";
import * as workspaceTrusted from "./workspaceTrusted.js";

export async function runAllPreflight(folder?: string): Promise<PreflightResult> {
  const resolved = await orchestratorProjectDir();
  const wsFolder = folder ?? resolved.dir;
  const entries: Array<[string, Promise<PreflightCheck>]> = [
    ["claude_present", claudePresent.check()],
    ["claude_version", claudeVersion.check()],
    ["authenticated", authenticated.check()],
    ["workspace_trusted", workspaceTrusted.check(wsFolder)],
    ["outbound_https", outboundHttps.check()],
    ["state_writable", stateWritable.check()],
    ["platform_detach_support", platformDetach.check()],
  ];

  const checks: Record<string, PreflightCheck> = {};
  for (const [name, p] of entries) {
    checks[name] = await p;
  }
  const projectDirCheck: PreflightCheck = {
    ok: resolved.source !== "process.cwd()" || !resolved.warning,
    value: resolved.dir,
    method: resolved.source,
    ...(resolved.warning ? { reason: resolved.warning } : {}),
  };
  checks["orchestrator_project_dir"] = projectDirCheck;
  const blocking = Object.entries(checks)
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);
  return {
    ok: blocking.length === 0,
    checks,
    blocking,
  };
}
