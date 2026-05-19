#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { isCrmError } from "./errors.js";
import { registerListRoots } from "./paths.js";
import * as checkRemoteReady from "./tools/checkRemoteReady.js";
import * as getSessionLink from "./tools/getSessionLink.js";
import * as installMcpServer from "./tools/installMcpServer.js";
import * as installPlugin from "./tools/installPlugin.js";
import * as listSessions from "./tools/listSessions.js";
import * as mergeBackSession from "./tools/mergeBackSession.js";
import * as spawnRemote from "./tools/spawnRemote.js";
import * as stopSession from "./tools/stopSession.js";

interface ToolModule {
  definition: { name: string; description: string; inputSchema: object };
  handler: (raw: unknown) => Promise<unknown>;
}

const TOOLS: ToolModule[] = [
  checkRemoteReady,
  spawnRemote,
  listSessions,
  stopSession,
  getSessionLink,
  installPlugin,
  installMcpServer,
  mergeBackSession,
];

function verbose(): boolean {
  return process.env["CLAUDE_REMOTE_MCP_VERBOSE"] === "true";
}

function logEvent(record: Record<string, unknown>): void {
  if (!verbose()) return;
  try {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
  } catch {
    // ignore log failure
  }
}

async function main(): Promise<void> {
  const server = new Server(
    {
      name: "claude-remote-mcp",
      version: "0.1.4",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS.map((t) => t.definition),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = TOOLS.find((t) => t.definition.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    const start = Date.now();
    try {
      const result = await tool.handler(req.params.arguments ?? {});
      logEvent({ tool: name, ok: true, durationMs: Date.now() - start });
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      logEvent({
        tool: name,
        ok: false,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      });
      if (isCrmError(err)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(err.toJSON(), null, 2),
            },
          ],
        };
      }
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { code: "INTERNAL_ERROR", message: (err as Error).message },
              null,
              2,
            ),
          },
        ],
      };
    }
  });

  registerListRoots(async () => {
    const caps = server.getClientCapabilities();
    if (!caps || !caps["roots"]) {
      throw new Error("client does not advertise roots capability");
    }
    return server.listRoots();
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logEvent({ event: "server_started", pid: process.pid });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
