import { hostname } from "node:os";
import { reconcile, readState } from "../registry.js";
import { ListInputSchema } from "../types.js";

export const definition = {
  name: "list_remote_sessions",
  description:
    "List Claude Remote Control sessions tracked in the local registry. Reconciles dead PIDs before returning. Defaults to only-alive on current host.",
  inputSchema: {
    type: "object",
    properties: {
      filter_tags: { type: "array", items: { type: "string" } },
      only_alive: { type: "boolean", default: true },
      include_other_hosts: { type: "boolean", default: false },
    },
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = ListInputSchema.parse(raw ?? {});
  await reconcile();
  const state = readState();
  const host = hostname();

  let entries = state.sessions;

  if (!input.include_other_hosts) {
    entries = entries.filter((e) => e.owner_hostname === host);
  }
  if (input.only_alive) {
    entries = entries.filter((e) => e.status === "alive");
  }
  if (input.filter_tags && input.filter_tags.length > 0) {
    entries = entries.filter((e) =>
      input.filter_tags!.every((t) => e.tags.includes(t)),
    );
  }

  return { sessions: entries, total: entries.length };
}
