# Task 03 — State registry + audit log

**Milestone**: M1

**Architecture refs**: ARCH-4, ARCH-5

## Deliverables

- `src/registry.ts`:
  - `readState()` / `writeStateAtomic(state)` — atomic via tmp + rename.
  - `mutate(fn)` — acquire `proper-lockfile`, RMW, release.
  - `reconcile()` — mark dead PIDs.
  - `generateSessionId(state)` — `<hostname>-<adj>-<noun>`, collision-retry.
- `src/audit.ts`:
  - `appendAudit(event, data)` — JSONL append.
- Wordlists embedded (`adjectives.ts`, `nouns.ts` ~20 each).

## Acceptance

- 100 parallel `mutate(addSession)` calls → state có đúng 100 entry, không
  corrupt.
- `reconcile()` flip status `alive → dead` cho PID không tồn tại.
- Audit log có 1 dòng JSON 1 line per event.
