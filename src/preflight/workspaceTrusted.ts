import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PreflightCheck } from "../types.js";

export async function check(folder: string): Promise<PreflightCheck> {
  const cfgPath = path.join(homedir(), ".claude.json");
  if (!existsSync(cfgPath)) {
    return {
      ok: false,
      folder,
      reason: "No ~/.claude.json found — run `claude` in the project folder once to accept trust dialog.",
    };
  }
  try {
    const raw = readFileSync(cfgPath, "utf8");
    const data = JSON.parse(raw) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
    const projects = data.projects ?? {};
    const trusted = projects[folder]?.hasTrustDialogAccepted === true;
    if (trusted) return { ok: true, folder };
    return {
      ok: false,
      folder,
      reason: `Folder ${folder} not workspace-trusted. Run \`claude\` there to accept trust dialog.`,
    };
  } catch (err) {
    return { ok: false, folder, reason: (err as Error).message };
  }
}
