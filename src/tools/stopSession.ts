import { appendAudit } from "../audit.js";
import { CrmError, ErrorCodes } from "../errors.js";
import { gracefulKill } from "../platform.js";
import { findSession, mutate } from "../registry.js";
import { StopInputSchema } from "../types.js";

export const definition = {
  name: "stop_remote_session",
  description:
    "Stop a Claude Remote Control session by session_id or pid. Sends SIGTERM, falls back to SIGKILL after 5s. Updates state registry.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      pid: { type: "number" },
    },
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = StopInputSchema.parse(raw ?? {});

  const target = await mutate((state) => {
    const entry = findSession(state, input);
    if (!entry) {
      throw new CrmError(
        ErrorCodes.SESSION_NOT_FOUND,
        `No session found matching ${JSON.stringify(input)}`,
      );
    }
    return { state, result: { ...entry } };
  });

  const killRes = await gracefulKill(target.pid);

  const updated = await mutate((state) => {
    const entry = state.sessions.find((s) => s.session_id === target.session_id);
    if (entry) {
      entry.status = "stopped";
      entry.stopped_at = new Date().toISOString();
    }
    return { state, result: entry };
  });

  appendAudit("session_stopped", {
    session_id: target.session_id,
    pid: target.pid,
    signal: killRes.signal,
  });

  return {
    session_id: target.session_id,
    pid: target.pid,
    killed: killRes.killed,
    signal: killRes.signal,
    entry: updated,
  };
}
