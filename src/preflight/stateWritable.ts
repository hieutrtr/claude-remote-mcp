import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataHome } from "../paths.js";
import type { PreflightCheck } from "../types.js";

export async function check(): Promise<PreflightCheck> {
  const dir = dataHome();
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe.${process.pid}`);
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return { ok: true, path: dir };
  } catch (err) {
    return { ok: false, path: dir, reason: (err as Error).message };
  }
}
