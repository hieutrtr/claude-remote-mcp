import { appendAudit } from "../audit.js";
import { CrmError, ErrorCodes } from "../errors.js";
import {
  abortMergeOrRebase,
  branchDelete,
  checkout,
  currentBranch,
  gitTopLevel,
  merge,
  statusPorcelain,
  worktreeRemove,
} from "../git.js";
import { gracefulKill, pidAlive } from "../platform.js";
import { findSession, mutate } from "../registry.js";
import { MergeBackInputSchema } from "../types.js";

export const definition = {
  name: "merge_back_session",
  description:
    "Merge commits from a worktree-mode session's branch back into a target branch. Stops the session first if alive. Returns conflict list on failure without touching the repo state.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      target_branch: { type: "string" },
      strategy: { type: "string", enum: ["merge", "rebase", "squash"], default: "rebase" },
      remove_worktree: { type: "boolean", default: true },
    },
    required: ["session_id", "target_branch"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown): Promise<unknown> {
  const input = MergeBackInputSchema.parse(raw);

  const session = await mutate((state) => {
    const entry = findSession(state, { session_id: input.session_id });
    if (!entry) {
      throw new CrmError(
        ErrorCodes.SESSION_NOT_FOUND,
        `Session ${input.session_id} not in registry`,
      );
    }
    if (entry.spawn_mode !== "worktree" || !entry.worktree_branch) {
      throw new CrmError(
        ErrorCodes.NOT_A_WORKTREE_SESSION,
        `Session ${input.session_id} was not spawned in worktree mode`,
      );
    }
    return { state, result: { ...entry } };
  });

  if (pidAlive(session.pid)) {
    await gracefulKill(session.pid);
    await mutate((state) => {
      const e = state.sessions.find((s) => s.session_id === session.session_id);
      if (e) {
        e.status = "stopped";
        e.stopped_at = new Date().toISOString();
      }
      return { state, result: undefined };
    });
  }

  const worktreePath = session.working_dir;
  const dirty = await statusPorcelain(worktreePath);
  if (dirty.trim().length > 0) {
    throw new CrmError(
      ErrorCodes.WORKTREE_DIRTY,
      `Worktree at ${worktreePath} has uncommitted changes`,
      { details: { porcelain: dirty } },
    );
  }

  const repoRoot = await gitTopLevel(worktreePath);
  const originalBranch = await currentBranch(repoRoot);

  await checkout(repoRoot, input.target_branch);
  const branch = session.worktree_branch as string;
  const result = await merge(repoRoot, branch, { strategy: input.strategy });

  if (!result.ok) {
    await abortMergeOrRebase(repoRoot);
    try {
      await checkout(repoRoot, originalBranch);
    } catch {
      // best-effort revert
    }
    throw new CrmError(
      ErrorCodes.MERGE_CONFLICT,
      `Merge conflict applying ${branch} into ${input.target_branch} via ${input.strategy}`,
      { details: { conflicts: result.conflicts, stderr: result.stderr.slice(-500) } },
    );
  }

  if (input.remove_worktree) {
    await worktreeRemove(repoRoot, worktreePath);
    await branchDelete(repoRoot, branch);
  }

  appendAudit("session_merged_back", {
    session_id: session.session_id,
    target_branch: input.target_branch,
    strategy: input.strategy,
    branch,
  });

  return {
    session_id: session.session_id,
    merged_into: input.target_branch,
    strategy: input.strategy,
    branch,
    worktree_removed: input.remove_worktree,
  };
}
