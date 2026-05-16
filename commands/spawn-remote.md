---
description: Spawn a Claude Remote Control session in a folder (optionally a git worktree) and return the URL so the user can pick it up on mobile/web.
argument-hint: "<folder> [name=...] [mode=same-dir|worktree|session]"
---

Use the `spawn_remote_session` MCP tool from `claude-remote-mcp` with these
arguments parsed from `$ARGUMENTS`:

- `folder` — first positional argument (required).
- `name` — `name=` key/value pair if present, otherwise derive from folder
  basename.
- `spawn_mode` — `mode=` key/value pair, default `same-dir`. Accept aliases
  `wt`/`worktree` and `session`/`single`.
- `tags` — `tags=a,b,c` if present.

Steps:

1. If the user hasn't run `check_remote_ready` recently in this conversation,
   call it first and surface any `blocking` items before spawning.
2. Call `spawn_remote_session` with the parsed arguments.
3. Print the returned `url` clearly so it is easy to tap on mobile.
4. Tell the user they can continue the session from `claude.ai/code` or the
   Claude mobile app, and that this orchestrator session does not need to
   stay open for the remote child to keep running.
