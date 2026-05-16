import { platform } from "node:os";
import type { PreflightCheck } from "../types.js";

export async function check(): Promise<PreflightCheck> {
  const p = platform();
  const supported = p === "linux" || p === "darwin" || p === "win32";
  return supported
    ? { ok: true, platform: p }
    : { ok: false, platform: p, reason: `Unsupported platform: ${p}` };
}
