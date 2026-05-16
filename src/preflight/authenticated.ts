import { runClaude } from "../claudeCli.js";
import type { PreflightCheck } from "../types.js";

interface AuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
}

export async function check(): Promise<PreflightCheck> {
  if (process.env["ANTHROPIC_API_KEY"]) {
    return {
      ok: false,
      reason: "ANTHROPIC_API_KEY is set — Remote Control requires claude.ai OAuth, not API key",
      method: "api_key",
    };
  }
  if (process.env["CLAUDE_CODE_OAUTH_TOKEN"]) {
    return {
      ok: false,
      reason: "CLAUDE_CODE_OAUTH_TOKEN is set — long-lived tokens are inference-only and cannot establish Remote Control sessions",
      method: "oauth_token",
    };
  }

  let res;
  try {
    res = await runClaude(["auth", "status"], { timeoutMs: 10_000 });
  } catch (err) {
    return {
      ok: false,
      reason: `Could not run \`claude auth status\`: ${(err as Error).message}`,
      method: "unknown",
    };
  }
  if (res.exitCode !== 0) {
    return {
      ok: false,
      reason: `\`claude auth status\` exited ${res.exitCode}. stderr: ${res.stderr.trim().slice(0, 200)}`,
      method: "unknown",
    };
  }

  let parsed: AuthStatus;
  try {
    parsed = JSON.parse(res.stdout) as AuthStatus;
  } catch {
    return {
      ok: false,
      reason: `Unparseable \`claude auth status\` output: ${res.stdout.trim().slice(0, 200)}`,
      method: "unknown",
    };
  }

  if (!parsed.loggedIn) {
    return {
      ok: false,
      reason: "Not logged in. Run `claude` then `/login` and choose the claude.ai option.",
      method: parsed.authMethod ?? "none",
    };
  }
  if (parsed.authMethod === "oauth_token") {
    return {
      ok: false,
      reason: "Authenticated with a long-lived token (`claude setup-token`). Remote Control requires the full-scope claude.ai OAuth session — run `/login` interactively to switch.",
      method: parsed.authMethod,
    };
  }
  if (parsed.apiProvider && parsed.apiProvider !== "firstParty") {
    return {
      ok: false,
      reason: `Authenticated via ${parsed.apiProvider}. Remote Control requires claude.ai (firstParty) auth.`,
      method: parsed.authMethod ?? "unknown",
    };
  }

  return { ok: true, method: parsed.authMethod ?? "claude.ai" };
}
