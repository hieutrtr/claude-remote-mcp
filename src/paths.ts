import { homedir } from "node:os";
import path from "node:path";
import { CrmError, ErrorCodes } from "./errors.js";

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
 * The user's project root, used as the anchor for resolving relative
 * `folder` inputs and for locating the parent git repo in worktree mode.
 *
 * Resolution order (first non-empty wins; an entry pointing inside the
 * plugin install cache is rejected):
 *
 *   1. CLAUDE_REMOTE_MCP_PROJECT_DIR (explicit user override)
 *   2. CLAUDE_PROJECT_DIR (set by Claude Code for MCP server subprocesses)
 *   3. server.listRoots() via MCP, when the client advertises roots
 *   4. PWD env (the shell launcher's cwd)
 *   5. process.cwd(), iff it is NOT inside the plugin install cache
 *
 * If every strategy fails, we throw INVALID_INPUT — the alternative is
 * silently mkdir-ing into ~/.claude/plugins/cache/..., which is never what
 * the user wants.
 */
export interface ProjectDirResolved {
  dir: string;
  source:
    | "CLAUDE_REMOTE_MCP_PROJECT_DIR"
    | "CLAUDE_PROJECT_DIR"
    | "mcp:roots/list"
    | "PWD"
    | "process.cwd()";
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

export function isInsidePluginCache(dir: string): boolean {
  return dir.includes("/.claude/plugins/cache/") || dir.includes("\\.claude\\plugins\\cache\\");
}

export interface ProjectDirAttempt {
  source: ProjectDirResolved["source"];
  dir: string | null;
  rejected_reason?: string;
}

export interface ProjectDirOutcome {
  resolved: ProjectDirResolved | null;
  attempts: ProjectDirAttempt[];
}

export async function resolveOrchestratorProjectDir(): Promise<ProjectDirOutcome> {
  const attempts: ProjectDirAttempt[] = [];

  const tryStatic = (source: ProjectDirResolved["source"], dir: string | undefined) => {
    if (!dir) {
      attempts.push({ source, dir: null });
      return null;
    }
    if (isInsidePluginCache(dir)) {
      attempts.push({ source, dir, rejected_reason: "inside plugin install cache" });
      return null;
    }
    attempts.push({ source, dir });
    return { source, dir };
  };

  const a = tryStatic("CLAUDE_REMOTE_MCP_PROJECT_DIR", envNonEmpty("CLAUDE_REMOTE_MCP_PROJECT_DIR"));
  if (a) return { resolved: a, attempts };

  const b = tryStatic("CLAUDE_PROJECT_DIR", envNonEmpty("CLAUDE_PROJECT_DIR"));
  if (b) return { resolved: b, attempts };

  if (listRootsFn) {
    try {
      if (cachedRoots === null) {
        const result = await listRootsFn();
        cachedRoots = result.roots
          .map((r) => fileUriToPath(r.uri))
          .filter((p): p is string => typeof p === "string" && p.length > 0);
      }
      const rootDir = cachedRoots[0];
      const c = tryStatic("mcp:roots/list", rootDir);
      if (c) return { resolved: c, attempts };
    } catch (err) {
      attempts.push({
        source: "mcp:roots/list",
        dir: null,
        rejected_reason: `client error: ${(err as Error).message}`,
      });
    }
  } else {
    attempts.push({ source: "mcp:roots/list", dir: null, rejected_reason: "no client registered" });
  }

  const d = tryStatic("PWD", envNonEmpty("PWD"));
  if (d) return { resolved: d, attempts };

  const e = tryStatic("process.cwd()", process.cwd());
  if (e) return { resolved: e, attempts };

  return { resolved: null, attempts };
}

/**
 * Convenience: throws CrmError when no resolution succeeds. Used by tools
 * that require a project anchor (worktree, relative-path mkdir).
 */
export async function orchestratorProjectDir(): Promise<ProjectDirResolved> {
  const { resolved, attempts } = await resolveOrchestratorProjectDir();
  if (resolved) return resolved;
  throw new CrmError(
    ErrorCodes.INVALID_INPUT,
    "Cannot determine the orchestrator project directory. The MCP server is running inside the plugin install cache and no usable project path was provided. Pass an absolute folder path, or set CLAUDE_REMOTE_MCP_PROJECT_DIR (e.g. `export CLAUDE_REMOTE_MCP_PROJECT_DIR=\"$PWD\"` before launching `claude`).",
    { details: { attempts } },
  );
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

/**
 * Expand a leading `~` or `~/...` to the current user's home directory.
 * Standalone `~` becomes the home dir; `~/foo` becomes `<home>/foo`. Any
 * other form (like `~user/foo`) is returned unchanged because we cannot
 * resolve other users' homes portably without parsing /etc/passwd.
 *
 * Critical for `spawn_remote_session`: agents often pass paths like
 * `~/projects/demo` literally, expecting shell-style expansion. Without
 * this we would mkdir a folder named `~` inside the project dir.
 */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}
