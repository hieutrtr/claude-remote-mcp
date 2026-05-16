# Task 04 — Claude CLI wrapper + check_remote_ready

**Milestone**: M0/M1

**Architecture refs**: ARCH-7, ARCH-6.8

## Deliverables

- `src/claudeCli.ts` — wrappers liệt kê tại ARCH-7.2.
- `src/preflight/*.ts` — 1 file/check theo ARCH-6.8.
- `src/tools/checkRemoteReady.ts` — MCP tool composing all checks.
- Register tool ở `src/server.ts`.

## Acceptance

- `check_remote_ready` chạy được, trả JSON đúng schema.
- `claude_present` resolve được binary trên Linux/macOS/Windows.
- `claude_version` parse `--version` chính xác, compare semver.
- Mỗi sub-check fail/pass độc lập, không cascade.
