# Task 05 — spawn_remote_session

**Milestone**: M1

**Architecture refs**: ARCH-3.2, ARCH-6.1, ARCH-8.1

## Deliverables

- `src/tools/spawnRemote.ts` theo ARCH-6.1.
- Hỗ trợ `spawn_mode: same-dir | worktree | session`.
- URL tail parser với regex từ `CLAUDE_REMOTE_MCP_URL_REGEX`.
- Worktree branch creation khi mode = worktree.
- Append entry vào state under lock.
- Audit `session_spawned` / `session_spawn_failed`.

## Acceptance

- Spawn vào folder mới → folder được tạo, child PID alive.
- Kill orchestrator (parent Node) → child vẫn alive sau 60s.
- URL parse trả về URL hợp lệ trong < 30s (manual smoke với `claude` thật).
- Timeout đúng cách khi không bắt được URL (test bằng spawn fake binary).
- Worktree mode: branch được tạo, worktree dir tồn tại.
