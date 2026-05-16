# Task 06 — list / stop / get_session_link

**Milestone**: M2

**Architecture refs**: ARCH-6.2, ARCH-6.3, ARCH-6.4, ARCH-3.3, ARCH-3.4

## Deliverables

- `src/tools/listSessions.ts` — filter by tags, `only_alive`, `include_other_hosts`.
- `src/tools/stopSession.ts` — SIGTERM → SIGKILL fallback.
- `src/tools/getSessionLink.ts` — read-only lookup.
- Register tất cả trong `src/server.ts`.

## Acceptance

- `list_remote_sessions` reconcile trước khi return — dead PIDs flip status.
- `stop_remote_session` kill thực sự, update state, audit.
- `get_session_link` trả URL + QR ascii (nếu state có).
- Race: 2 client stop cùng 1 session → 1 thành công, 1 fail gracefully `SESSION_NOT_FOUND`.
