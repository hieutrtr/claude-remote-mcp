import { CrmError, ErrorCodes } from "../errors.js";
import { readState } from "../registry.js";
import { GetLinkInputSchema } from "../types.js";

export const definition = {
  name: "get_session_link",
  description:
    "Re-fetch the URL and QR ASCII for a previously-spawned session by session_id. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = GetLinkInputSchema.parse(raw);
  const state = readState();
  const entry = state.sessions.find((s) => s.session_id === input.session_id);
  if (!entry) {
    throw new CrmError(
      ErrorCodes.SESSION_NOT_FOUND,
      `Session ${input.session_id} not in registry`,
    );
  }
  return {
    session_id: entry.session_id,
    name: entry.name,
    url: entry.url,
    qr_ascii: entry.qr_ascii,
    status: entry.status,
    pid: entry.pid,
    working_dir: entry.working_dir,
  };
}
