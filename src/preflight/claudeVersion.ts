import semver from "semver";
import { claudeVersion } from "../claudeCli.js";
import type { PreflightCheck } from "../types.js";

const REQUIRED = ">=2.1.51";

export async function check(): Promise<PreflightCheck> {
  try {
    const v = await claudeVersion();
    const ok = semver.satisfies(v, REQUIRED);
    return {
      ok,
      value: v,
      required: REQUIRED,
      ...(ok ? {} : { reason: `Need ${REQUIRED}, got ${v}` }),
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message, required: REQUIRED };
  }
}
