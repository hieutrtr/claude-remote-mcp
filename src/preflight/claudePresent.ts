import { resolveClaudeBin } from "../claudeCli.js";
import type { PreflightCheck } from "../types.js";

export async function check(): Promise<PreflightCheck> {
  try {
    const p = resolveClaudeBin();
    return { ok: true, value: p };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
