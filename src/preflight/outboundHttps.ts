import type { PreflightCheck } from "../types.js";

export async function check(): Promise<PreflightCheck> {
  const url = "https://api.anthropic.com";
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(t);
    return { ok: res.status > 0, value: res.status };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
