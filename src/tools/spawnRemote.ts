import { mkdirSync, openSync, closeSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
      dangerously_skip_permissions: { type: "boolean", description: "When true (default), maximize the autonomy of the spawned session by launching with `--permission-mode acceptEdits` AND writing broad `permissions.allow` rules into the working dir's .claude/settings.local.json. Note: Remote Control sessions cannot actually use `bypassPermissions` or `auto` mode — Claude restricts those for safety since the user is likely on mobile. `acceptEdits` + broad allow list is the closest approximation. Set false to keep the standard prompt flow.", default: true },
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

  // Permission strategy for Remote Control sessions.
  //
  // The official docs are explicit: for Remote Control sessions, only
  // "Ask permissions", "Auto accept edits", and "Plan" modes are
  // available. **Auto and Bypass permissions are NOT available** —
  // Claude silently downgrades both to acceptEdits, by design (a user
  // driving the session from mobile is potentially away from the
  // keyboard, so the most permissive mode is gated off).
  //
  // We therefore aim for "as autonomous as Claude lets us":
  //   1. Pass `--permission-mode acceptEdits` to launch the session in
  //      the highest mode Remote Control allows.
  //   2. Layer broad `permissions.allow` rules into
  //      `.claude/settings.local.json` so Bash, WebFetch, WebSearch,
  //      Agent (and the rest of the built-in toolbelt) don't prompt
  //      either. `allow` rules ARE honored in project/local settings;
  //      only `defaultMode: bypassPermissions/auto` is restricted there.
  //
  // The combined effect approximates bypassPermissions for everything
  // the session is likely to do inside its own working dir. Writes
  // outside the working dir, and tools matching `ask` or `deny` rules,
  // still prompt — but those are usually what you want anyway.
  //
  // Parser detail: any global flag placed BEFORE the `remote-control`
  // subcommand switches claude into interactive prompt mode and the
  // subcommand's options get rejected as "unknown". So we always put
  // the subcommand first and let it own all subsequent flags.
  //
  // initial_prompt is not supported by `claude remote-control` (server
  // mode); the only way to seed a prompt is the interactive form
  // `claude --remote-control "<name>"`, where the positional value is
  // the session NAME, not a prompt. We keep the field for forward
  // compatibility but treat it as a no-op for now.
  if (input.dangerously_skip_permissions) {
    writeBroadAllowSettings(workingDir);
  }

  const argv: string[] = ["remote-control", "--name", sessionName];
  if (input.spawn_mode === "session") {
    argv.push("--spawn", "session");
  } else if (input.spawn_mode === "worktree") {
    argv.push("--spawn", "worktree");
  }
  if (input.sandbox) argv.push("--sandbox");
  if (input.dangerously_skip_permissions) {
    argv.push("--permission-mode", "acceptEdits");
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

/**
 * Broad allow list of built-in tools so `acceptEdits` mode (the highest
 * mode Remote Control sessions can actually enter) doesn't prompt for
 * Bash, WebFetch, etc. Project/local settings cannot grant
 * `defaultMode: bypassPermissions`, but they CAN list bare tool names in
 * `permissions.allow`, which has the same effect of skipping the prompt.
 *
 * MCP server tools follow the `mcp__<server>__<tool>` naming scheme and
 * cannot be matched with a generic wildcard, so users with MCP servers
 * still get prompted for them. We document this in the README; users can
 * add per-server allow rules themselves if needed.
 */
const BROAD_ALLOW: readonly string[] = [
  "Bash",
  "WebFetch",
  "WebSearch",
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "Glob",
  "Grep",
  "NotebookEdit",
  "Agent",
];

function writeBroadAllowSettings(workingDir: string): void {
  const settingsDir = path.join(workingDir, ".claude");
  const settingsFile = path.join(settingsDir, "settings.local.json");
  mkdirSync(settingsDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(settingsFile)) {
    try {
      const raw = readFileSync(settingsFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt or unreadable — start fresh rather than crash.
    }
  }

  const permsRaw = existing["permissions"];
  const perms: Record<string, unknown> =
    permsRaw && typeof permsRaw === "object" && !Array.isArray(permsRaw)
      ? (permsRaw as Record<string, unknown>)
      : {};
  const existingAllow: unknown = perms["allow"];
  const allowList: string[] = Array.isArray(existingAllow)
    ? (existingAllow as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  for (const rule of BROAD_ALLOW) {
    if (!allowList.includes(rule)) allowList.push(rule);
  }
  perms["allow"] = allowList;
  existing["permissions"] = perms;

  writeFileSync(settingsFile, JSON.stringify(existing, null, 2), { encoding: "utf8" });
}

export const __testing__ = { SpawnInputSchema, BROAD_ALLOW };
export type { SpawnInput };
