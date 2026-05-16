import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PreflightCheck } from "../types.js";

export async function check(): Promise<PreflightCheck> {
  if (process.env["ANTHROPIC_API_KEY"]) {
    return {
      ok: false,
      reason: "ANTHROPIC_API_KEY is set — Remote Control requires claude.ai OAuth, not API key",
      method: "api_key",
    };
  }
  const credPath = path.join(homedir(), ".claude", ".credentials.json");
  if (existsSync(credPath)) {
    try {
      const raw = readFileSync(credPath, "utf8");
      const data = JSON.parse(raw) as { claudeAiOauth?: unknown; oauthAccount?: unknown };
      if (data.claudeAiOauth || data.oauthAccount) {
        return { ok: true, method: "claude.ai" };
      }
    } catch {
      // fall through
    }
  }
  return {
    ok: false,
    reason: "No claude.ai OAuth credentials found. Run `claude` then `/login`.",
    method: "none",
  };
}
