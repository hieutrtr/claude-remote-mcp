# Task 08 — merge_back_session

**Milestone**: M4

**Architecture refs**: ARCH-6.7

## Deliverables

- `src/tools/mergeBackSession.ts` theo ARCH-6.7.
- Helper `src/git.ts` cho git operations: `worktreeAdd`, `worktreeRemove`,
  `branchDelete`, `merge`, `rebase`, `squashMerge`, `status`.

## Acceptance

- `merge_back_session` từ worktree session → merge thành công 3 strategy.
- Conflict → return `MERGE_CONFLICT` với danh sách file conflict, không
  side-effect.
- Dirty worktree → fail `WORKTREE_DIRTY` không thao tác git.
- `remove_worktree=true` → worktree + branch xoá sau khi merge OK.
