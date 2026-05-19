import { mkdirSync, openSync, closeSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { appendAudit } from "../audit.js";
import { resolveClaudeBin } from "../claudeCli.js";
import { CrmError, ErrorCodes } from "../errors.js";
import {
  defaultWorktreePath,
  gitInit,
  gitTopLevel,
  isGitRepo,
  worktreeAdd,
} from "../git.js";
import { spawnDetached } from "../platform.js";
import { childLogPath, dataHome, expandTilde, orchestratorProjectDir, resolveOrchestratorProjectDir } from "../paths.js";
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
      initial_prompt: { type: "string", description: "DEPRECATED / no-op. `claude remote-control` server mode does not accept an initial prompt. Send the first message from claude.ai/code or the mobile app instead. Passing this field returns a `notice` in the response and changes nothing else." },
      tags: { type: "array", items: { type: "string" }, default: [] },
      git_init: { type: "boolean", description: "After mkdir, run `git init -b <branch>` and create an empty initial commit so the session starts with its own clean repo. Defaults to true. Silently ignored for spawn_mode=worktree (which branches off an existing repo).", default: true },
      git_init_branch: { type: "string", description: "Branch name passed to `git init -b` when git_init is true.", default: "main" },
      dangerously_skip_permissions: { type: "boolean", description: "Pass `--dangerously-skip-permissions` to the spawned `claude` process so the remote session never prompts for tool approval. Defaults to true — remote sessions are designed to be driven from mobile/web where tapping approve is painful. Pass false to keep the standard permission flow.", default: true },
    },
    required: ["folder"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = SpawnInputSchema.parse(raw);
  const claudeBin = resolveClaudeBin();

  // Expand a leading `~` BEFORE deciding whether the path is absolute.
  // Agents often pass `~/projects/demo` literally; without expansion that
  // string is considered relative and would land at `<projectDir>/~/...`.
  const folderInput = expandTilde(input.folder);
  const needsProjectDir = !path.isAbsolute(folderInput) || input.spawn_mode === "worktree";
  let projectDir: string | null = null;
  let projectDirSource: string = "not-needed";
  let projectDirAttempts: unknown = undefined;

  if (needsProjectDir) {
    const resolved = await resolveOrchestratorProjectDir();
    projectDirAttempts = resolved.attempts;
    if (!resolved.resolved) {
      throw new CrmError(
        ErrorCodes.INVALID_INPUT,
        path.isAbsolute(folderInput)
          ? `spawn_mode=worktree needs the orchestrator project dir but none could be resolved. Pass CLAUDE_REMOTE_MCP_PROJECT_DIR or run claude from inside your repo.`
          : `Cannot resolve a project directory to anchor "${input.folder}". Pass an absolute folder path (including \`~/...\`), or set CLAUDE_REMOTE_MCP_PROJECT_DIR (e.g. \`export CLAUDE_REMOTE_MCP_PROJECT_DIR="$PWD"\` before launching claude).`,
        { details: { attempts: resolved.attempts, folder: input.folder, folder_expanded: folderInput, spawn_mode: input.spawn_mode } },
      );
    }
    projectDir = resolved.resolved.dir;
    projectDirSource = resolved.resolved.source;
  }

  const absFolder = path.isAbsolute(folderInput)
    ? folderInput
    : path.resolve(projectDir as string, folderInput);
  const sessionName = input.name ?? (path.basename(absFolder) || "remote-session");

  let workingDir = absFolder;
  let worktreeBranch: string | null = null;

  if (input.spawn_mode === "worktree") {
    // git_init is silently ignored: a worktree branches off an existing repo
    // and has no `.git` to init. We do NOT error here because git_init now
    // defaults to true, so every worktree spawn would otherwise fail.
    const anchor = projectDir as string;
    if (!(await isGitRepo(anchor))) {
      throw new CrmError(
        ErrorCodes.NOT_A_GIT_REPO,
        `spawn_mode=worktree requires the orchestrator project dir to be inside a git repo. Tried: ${anchor} (resolved via ${projectDirSource})`,
        {
          details: {
            project_dir: anchor,
            project_dir_source: projectDirSource,
            attempts: projectDirAttempts,
          },
        },
      );
    }
    const repoRoot = await gitTopLevel(anchor);
    workingDir = path.isAbsolute(folderInput)
      ? folderInput
      : defaultWorktreePath(repoRoot, sessionName);
    worktreeBranch = input.worktree_branch ?? `claude/${sessionName}`;
    await worktreeAdd(repoRoot, workingDir, worktreeBranch);
  } else {
    mkdirSync(workingDir, { recursive: true });
    if (input.git_init && !(await isGitRepo(workingDir))) {
      await gitInit(workingDir, {
        initialBranch: input.git_init_branch,
        initialCommit: true,
      });
    }
  }

  const sessionId = await mutate((state) => {
    const existing = new Set(state.sessions.map((s) => s.session_id));
    const id = generateSessionId(existing);
    return { state, result: id };
  });

  mkdirSync(path.join(dataHome(), "logs"), { recursive: true });
  const logFile = childLogPath(sessionId);
  const logFd = openSync(logFile, "a");

  // The `remote-control` subcommand parser is strict: any global flag
  // placed BEFORE the subcommand (e.g. `claude --dangerously-skip-permissions
  // remote-control ...`) switches claude into interactive prompt mode and
  // rejects the subcommand's own options as "unknown". So we always put the
  // subcommand first and let it own all subsequent flags.
  //
  // initial_prompt is not supported by `claude remote-control` (server
  // mode); the only way to seed a prompt is the interactive form
  // `claude --remote-control "<name>"`, where the positional value is the
  // session NAME, not a prompt. We keep the field for forward compatibility
  // but treat it as a no-op for now.
  const argv: string[] = ["remote-control", "--name", sessionName];
  if (input.spawn_mode === "session") {
    argv.push("--spawn", "session");
  } else if (input.spawn_mode === "worktree") {
    argv.push("--spawn", "worktree");
  }
  if (input.sandbox) argv.push("--sandbox");
  if (input.dangerously_skip_permissions) {
    argv.push("--dangerously-skip-permissions");
  }
  const initialPromptIgnored = Boolean(input.initial_prompt);

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
    project_dir: projectDir,
    project_dir_source: projectDirSource,
  });

  return {
    ...entry,
    project_dir_used: projectDir,
    project_dir_source: projectDirSource,
    ...(initialPromptIgnored
      ? {
          notice:
            "initial_prompt was ignored: `claude remote-control` server mode does not accept an initial prompt. Send the first message from claude.ai/code or the mobile app instead.",
        }
      : {}),
  };
}

export const __testing__ = { SpawnInputSchema };
export type { SpawnInput };
