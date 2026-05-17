import { homedir } from "node:os";
import path from "node:path";

export function dataHome(): string {
  const override = process.env["CLAUDE_REMOTE_MCP_HOME"];
  if (override && override.length > 0) return override;
  const xdg = process.env["XDG_STATE_HOME"];
  if (xdg && xdg.length > 0) {
    return path.join(xdg, "claude-remote-mcp");
  }
  return path.join(homedir(), ".claude-remote-mcp");
}

export function stateFilePath(): string {
  return path.join(dataHome(), "state.json");
}

export function auditLogPath(): string {
  return path.join(dataHome(), "audit.log");
}

export function childLogPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dataHome(), "logs", `${safe}.log`);
}

export function lockFilePath(): string {
  return `${stateFilePath()}.lock`;
}

/**
 * The user's project root, as exposed by Claude Code via the
 * CLAUDE_PROJECT_DIR env var (same value passed to hooks). Used so that
 * relative `folder` inputs resolve against the orchestrator's actual project
 * directory rather than the MCP server process cwd (which, when the plugin
 * is installed, is the plugin install directory itself — definitely NOT
 * where the user wants worktrees / mkdir to happen).
 *
 * Resolution order (first non-empty wins):
 *   1. CLAUDE_REMOTE_MCP_PROJECT_DIR (explicit user override)
 *   2. CLAUDE_PROJECT_DIR (set by Claude Code for MCP server subprocesses)
 *   3. server.listRoots() via MCP, if a server has been registered
 *   4. PWD env (the shell launcher's cwd; usually correct)
 *   5. process.cwd() (last resort — wrong when plugin is installed)
 */
export interface ProjectDirResolved {
  dir: string;
  source:
    | "CLAUDE_REMOTE_MCP_PROJECT_DIR"
    | "CLAUDE_PROJECT_DIR"
    | "mcp:roots/list"
    | "PWD"
    | "process.cwd()";
  warning?: string;
}

type ListRootsFn = () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;

let listRootsFn: ListRootsFn | null = null;
let cachedRoots: string[] | null = null;

export function registerListRoots(fn: ListRootsFn): void {
  listRootsFn = fn;
  cachedRoots = null;
}

function envNonEmpty(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function isInsidePluginCache(dir: string): boolean {
  return dir.includes("/.claude/plugins/cache/") || dir.includes("\\.claude\\plugins\\cache\\");
}

export async function orchestratorProjectDir(): Promise<ProjectDirResolved> {
  const override = envNonEmpty("CLAUDE_REMOTE_MCP_PROJECT_DIR");
  if (override) return { dir: override, source: "CLAUDE_REMOTE_MCP_PROJECT_DIR" };

  const claudeProjectDir = envNonEmpty("CLAUDE_PROJECT_DIR");
  if (claudeProjectDir) return { dir: claudeProjectDir, source: "CLAUDE_PROJECT_DIR" };

  if (listRootsFn) {
    try {
      if (cachedRoots === null) {
        const result = await listRootsFn();
        cachedRoots = result.roots
          .map((r) => fileUriToPath(r.uri))
          .filter((p): p is string => typeof p === "string" && p.length > 0);
      }
      if (cachedRoots[0]) return { dir: cachedRoots[0], source: "mcp:roots/list" };
    } catch {
      // client may not support roots — fall through
    }
  }

  const pwd = envNonEmpty("PWD");
  if (pwd && !isInsidePluginCache(pwd)) return { dir: pwd, source: "PWD" };

  const cwd = process.cwd();
  const result: ProjectDirResolved = { dir: cwd, source: "process.cwd()" };
  if (isInsidePluginCache(cwd)) {
    result.warning =
      "process.cwd() is inside the plugin install cache. The MCP client did not provide CLAUDE_PROJECT_DIR or roots/list. Set CLAUDE_REMOTE_MCP_PROJECT_DIR to your project root, or pass an absolute folder path.";
  }
  return result;
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return uri.length > 0 ? uri : null;
  try {
    const u = new URL(uri);
    return decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
}
