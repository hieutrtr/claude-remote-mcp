import { appendAudit } from "../audit.js";
import { claudePluginInstall } from "../claudeCli.js";
import { orchestratorProjectDir } from "../paths.js";
import { InstallPluginInputSchema } from "../types.js";

export const definition = {
  name: "install_plugin",
  description:
    "Install a Claude Code plugin into the current repo or user scope. Wraps `claude plugin install`. Useful because the /plugin slash command is local-only and cannot be invoked from claude.ai/code or mobile.",
  inputSchema: {
    type: "object",
    properties: {
      plugin: { type: "string", description: "Plugin name or marketplace ref." },
      scope: { type: "string", enum: ["user", "project", "local"], default: "project" },
      marketplace: { type: "string", description: "Optional marketplace URL." },
    },
    required: ["plugin"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = InstallPluginInputSchema.parse(raw);
  const res = await claudePluginInstall({
    plugin: input.plugin,
    scope: input.scope,
    marketplace: input.marketplace,
    cwd: (await orchestratorProjectDir()).dir,
  });
  appendAudit("plugin_installed", {
    plugin: input.plugin,
    scope: input.scope,
    version: res.version,
  });
  return {
    installed: true,
    plugin: input.plugin,
    scope: input.scope,
    version: res.version,
    output: res.stdout.slice(0, 2000),
  };
}
