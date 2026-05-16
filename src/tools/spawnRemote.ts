import { mkdirSync, openSync, closeSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { appendAudit } from "../audit.js";
import { resolveClaudeBin } from "../claudeCli.js";
import { CrmError, ErrorCodes } from "../errors.js";
import { defaultWorktreePath, isGitRepo, gitTopLevel, worktreeAdd } from "../git.js";
import { spawnDetached } from "../platform.js";
import { childLogPath, dataHome } from "../paths.js";
import {
  type SessionEntry,
  type SpawnInput,
  SpawnInputSchema,
} from "../types.js";
import { generateSessionId, mutate } from "../registry.js";
import { tailForUrl } from "../urlTail.js";

export const definition = {
  name: "spawn_remote_session",
  description:
    "Create a folder (or git worktree) if needed and spawn a `claude remote-control` process detached. Tails stdout for the session URL and registers it in the cross-session state file. Returns the URL/QR so the caller can hand off to mobile/web.",
  inputSchema: {
    type: "object",
    properties: {
      folder: { type: "string", description: "Path (absolute or relative) for the remote session." },
      name: { type: "string" },
      spawn_mode: { type: "string", enum: ["same-dir", "worktree", "session"], default: "same-dir" },
      worktree_branch: { type: "string" },
      sandbox: { type: "boolean" },
      initial_prompt: { type: "string", description: "Optional opening prompt; uses `claude --remote-control \"<prompt>\"` form when provided." },
      tags: { type: "array", items: { type: "string" }, default: [] },
    },
    required: ["folder"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = SpawnInputSchema.parse(raw);
  const claudeBin = resolveClaudeBin();
  const orchestratorCwd = process.cwd();

  const absFolder = path.resolve(orchestratorCwd, input.folder);
  const sessionName = input.name ?? (path.basename(absFolder) || "remote-session");

  let workingDir = absFolder;
  let worktreeBranch: string | null = null;

  if (input.spawn_mode === "worktree") {
    if (!(await isGitRepo(orchestratorCwd))) {
      throw new CrmError(
        ErrorCodes.NOT_A_GIT_REPO,
        `spawn_mode=worktree requires the orchestrator cwd to be inside a git repo`,
        { details: { cwd: orchestratorCwd } },
      );
    }
    const repoRoot = await gitTopLevel(orchestratorCwd);
    workingDir = path.isAbsolute(input.folder)
      ? input.folder
      : defaultWorktreePath(repoRoot, sessionName);
    worktreeBranch = input.worktree_branch ?? `claude/${sessionName}`;
    await worktreeAdd(repoRoot, workingDir, worktreeBranch);
  } else {
    mkdirSync(workingDir, { recursive: true });
  }

  const sessionId = await mutate((state) => {
    const existing = new Set(state.sessions.map((s) => s.session_id));
    const id = generateSessionId(existing);
    return { state, result: id };
  });

  mkdirSync(path.join(dataHome(), "logs"), { recursive: true });
  const logFile = childLogPath(sessionId);
  const logFd = openSync(logFile, "a");

  const argv: string[] = [];
  if (input.initial_prompt) {
    argv.push("--remote-control", input.initial_prompt);
  } else {
    argv.push("remote-control");
  }
  argv.push("--name", sessionName);
  if (input.spawn_mode === "session") {
    argv.push("--spawn", "session");
  } else if (input.spawn_mode === "worktree") {
    argv.push("--spawn", "worktree");
  }
  if (input.sandbox) argv.push("--sandbox");

  let child;
  try {
    child = spawnDetached(claudeBin, argv, {
      cwd: workingDir,
      logFd,
    });
  } finally {
    try { closeSync(logFd); } catch { /* noop */ }
  }

  if (!child.pid) {
    appendAudit("session_spawn_failed", { sessionId, reason: "no pid" });
    throw new CrmError(
      ErrorCodes.URL_TIMEOUT,
      `Failed to spawn child process (no pid)`,
      { details: { argv } },
    );
  }
  const childPid: number = child.pid;

  let urlResult;
  try {
    urlResult = await tailForUrl(logFile);
  } catch (err) {
    appendAudit("session_spawn_failed", {
      sessionId,
      pid: childPid,
      error: (err as Error).message,
    });
    throw err;
  }

  const entry: SessionEntry = {
    session_id: sessionId,
    name: sessionName,
    url: urlResult.url,
    qr_ascii: "",
    pid: childPid,
    working_dir: workingDir,
    spawn_mode: input.spawn_mode,
    worktree_branch: worktreeBranch,
    sandbox: input.sandbox ?? false,
    tags: input.tags,
    owner_orchestrator_pid: process.ppid ?? process.pid,
    owner_hostname: hostname(),
    started_at: new Date().toISOString(),
    stopped_at: null,
    died_at: null,
    status: "alive",
  };

  await mutate((state) => {
    state.sessions.push(entry);
    return { state, result: undefined };
  });

  appendAudit("session_spawned", {
    session_id: sessionId,
    pid: childPid,
    folder: workingDir,
    spawn_mode: input.spawn_mode,
  });

  return entry;
}

export const __testing__ = { SpawnInputSchema };
export type { SpawnInput };
