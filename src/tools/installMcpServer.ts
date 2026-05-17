import { appendAudit } from "../audit.js";
import { claudeMcpAdd } from "../claudeCli.js";
import { resolveOrchestratorProjectDir } from "../paths.js";
import { InstallMcpServerInputSchema } from "../types.js";

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CRED)/i;

export const definition = {
  name: "install_mcp_server",
  description:
    "Add an MCP server to Claude Code config. Wraps `claude mcp add`. Useful because the /mcp slash command is local-only.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      command: { type: "string" },
      args: { type: "array", items: { type: "string" }, default: [] },
      env: { type: "object", additionalProperties: { type: "string" } },
      scope: { type: "string", enum: ["user", "project", "local"], default: "project" },
    },
    required: ["name", "command"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = InstallMcpServerInputSchema.parse(raw);

  const warnings: string[] = [];
  if (input.env) {
    for (const k of Object.keys(input.env)) {
      if (SECRET_KEY.test(k)) {
        warnings.push(
          `env key "${k}" looks like a secret; it will be stored in plain text in claude config`,
        );
      }
    }
  }

  const resolved = await resolveOrchestratorProjectDir();
  const cwd = resolved.resolved?.dir ?? process.cwd();
  const res = await claudeMcpAdd({
    name: input.name,
    command: input.command,
    args: input.args,
    env: input.env,
    scope: input.scope,
    cwd,
  });

  appendAudit("mcp_server_installed", {
    name: input.name,
    command: input.command,
    scope: input.scope,
    warnings,
  });

  return {
    installed: true,
    name: input.name,
    scope: input.scope,
    warnings,
    output: res.stdout.slice(0, 2000),
  };
}
