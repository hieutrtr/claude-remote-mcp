import path from "node:path";
import { CrmError, ErrorCodes } from "./errors.js";
import { runCommand } from "./claudeCli.js";

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const res = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      timeoutMs: 5000,
    });
    return res.exitCode === 0 && res.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function gitTopLevel(cwd: string): Promise<string> {
  const res = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeoutMs: 5000,
  });
  if (res.exitCode !== 0) {
    throw new CrmError(
      ErrorCodes.NOT_A_GIT_REPO,
      `Not inside a git work tree: ${cwd}`,
    );
  }
  return res.stdout.trim();
}

export async function worktreeAdd(
  repoRoot: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  const res = await runCommand(
    "git",
    ["worktree", "add", "-b", branch, worktreePath],
    { cwd: repoRoot, timeoutMs: 60_000 },
  );
  if (res.exitCode !== 0) {
    throw new CrmError(
      ErrorCodes.WORKTREE_FAILED,
      `git worktree add failed: ${res.stderr.trim() || res.stdout.trim()}`,
      { details: { branch, worktreePath } },
    );
  }
}

export async function worktreeRemove(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  const res = await runCommand(
    "git",
    ["worktree", "remove", worktreePath],
    { cwd: repoRoot, timeoutMs: 30_000 },
  );
  if (res.exitCode !== 0) {
    throw new CrmError(
      ErrorCodes.WORKTREE_REMOVE_FAILED,
      `git worktree remove failed: ${res.stderr.trim() || res.stdout.trim()}`,
      { details: { worktreePath } },
    );
  }
}

export async function branchDelete(repoRoot: string, branch: string): Promise<void> {
  await runCommand("git", ["branch", "-D", branch], {
    cwd: repoRoot,
    timeoutMs: 10_000,
  });
}

export async function statusPorcelain(cwd: string): Promise<string> {
  const res = await runCommand("git", ["status", "--porcelain"], {
    cwd,
    timeoutMs: 10_000,
  });
  return res.stdout;
}

export async function currentBranch(cwd: string): Promise<string> {
  const res = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    timeoutMs: 5000,
  });
  return res.stdout.trim();
}

export async function checkout(cwd: string, branch: string): Promise<void> {
  const res = await runCommand("git", ["checkout", branch], {
    cwd,
    timeoutMs: 15_000,
  });
  if (res.exitCode !== 0) {
    throw new CrmError(
      ErrorCodes.WORKTREE_FAILED,
      `git checkout ${branch} failed: ${res.stderr.trim()}`,
    );
  }
}

export interface MergeResult {
  ok: boolean;
  conflicts: string[];
  stdout: string;
  stderr: string;
}

export async function merge(
  cwd: string,
  branch: string,
  opts: { strategy: "merge" | "rebase" | "squash" },
): Promise<MergeResult> {
  let res;
  if (opts.strategy === "merge") {
    res = await runCommand("git", ["merge", "--no-ff", branch], {
      cwd,
      timeoutMs: 60_000,
    });
  } else if (opts.strategy === "squash") {
    res = await runCommand("git", ["merge", "--squash", branch], {
      cwd,
      timeoutMs: 60_000,
    });
    if (res.exitCode === 0) {
      const commit = await runCommand(
        "git",
        ["commit", "-m", `Squash-merge ${branch}`],
        { cwd, timeoutMs: 30_000 },
      );
      if (commit.exitCode !== 0) {
        return {
          ok: false,
          conflicts: await parseConflicts(cwd),
          stdout: commit.stdout,
          stderr: commit.stderr,
        };
      }
    }
  } else {
    res = await runCommand("git", ["rebase", branch], { cwd, timeoutMs: 90_000 });
  }

  if (res.exitCode === 0) {
    return { ok: true, conflicts: [], stdout: res.stdout, stderr: res.stderr };
  }
  return {
    ok: false,
    conflicts: await parseConflicts(cwd),
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

async function parseConflicts(cwd: string): Promise<string[]> {
  const res = await runCommand(
    "git",
    ["diff", "--name-only", "--diff-filter=U"],
    { cwd, timeoutMs: 5000 },
  );
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function abortMergeOrRebase(cwd: string): Promise<void> {
  await runCommand("git", ["merge", "--abort"], { cwd, timeoutMs: 10_000 });
  await runCommand("git", ["rebase", "--abort"], { cwd, timeoutMs: 10_000 });
  await runCommand("git", ["reset", "--hard", "HEAD"], { cwd, timeoutMs: 10_000 });
}

export function defaultWorktreePath(repoRoot: string, sessionName: string): string {
  const safe = sessionName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return path.join(repoRoot, "..", `${path.basename(repoRoot)}-${safe}`);
}
