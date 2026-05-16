# Task 02 — Paths, platform helpers, error model

**Milestone**: M0

**Architecture refs**: ARCH-8, ARCH-10, ARCH-11.1, ARCH-8.4

## Deliverables

- `src/paths.ts` — `xdgStateHome`, `stateFilePath`, `auditLogPath`,
  `childLogPath`, honoring `CLAUDE_REMOTE_MCP_HOME`.
- `src/platform.ts` — `spawnDetached`, `pidAlive`, `gracefulKill` per ARCH-8.
- `src/errors.ts` — `CrmError` class + code enum (ARCH-10.2).
- Unit tests cho mỗi.

## Acceptance

- `pidAlive(process.pid)` → true.
- `pidAlive(99999999)` → false.
- `spawnDetached('sleep', ['3'])` → caller exit không kill child.
- `gracefulKill` SIGTERM → SIGKILL fallback hoạt động.
- `xdgStateHome()` honor `CLAUDE_REMOTE_MCP_HOME` override.
