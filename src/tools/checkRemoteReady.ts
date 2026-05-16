import { z } from "zod";
import { appendAudit } from "../audit.js";
import { runAllPreflight } from "../preflight/index.js";

export const definition = {
  name: "check_remote_ready",
  description:
    "Run all pre-flight checks (claude binary present, version >=2.1.51, authenticated, workspace trust, outbound https, state writable, platform detach support). Returns structured ok/blocking result. Call this BEFORE spawn_remote_session the first time.",
  inputSchema: {
    type: "object",
    properties: {
      folder: {
        type: "string",
        description: "Optional folder path to check workspace trust against. Defaults to current working directory.",
      },
    },
    additionalProperties: false,
  },
} as const;

export const InputSchema = z.object({
  folder: z.string().optional(),
});

export async function handler(raw: unknown): Promise<unknown> {
  const input = InputSchema.parse(raw ?? {});
  const result = await runAllPreflight(input.folder);
  appendAudit("preflight_run", { ok: result.ok, blocking: result.blocking });
  return result;
}
