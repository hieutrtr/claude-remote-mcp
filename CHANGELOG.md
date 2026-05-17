# Changelog

All notable changes to claude-remote-mcp.

## 0.1.2 — 2026-05-17

- **change**: `spawn_remote_session` now passes
  `--dangerously-skip-permissions` to the spawned `claude` process by
  default. Remote sessions are driven from mobile or web where tapping
  approve on every tool call is painful — defaulting to autonomous
  execution matches the actual use case. Pass
  `dangerously_skip_permissions: false` to keep the standard prompt
  flow per session.
- **add**: `scripts/bump.sh <version>` updates the version in all three
  source-of-truth files (plugin.json, package.json, src/server.ts) and
  rebuilds the bundle, so future releases can't silently drift again.

## 0.1.1 — 2026-05-17

- **fix**: `spawn_remote_session` now expands a leading `~` (e.g.
  `~/projects/demo`) to `$HOME` before deciding absolute vs relative.
  Previously the literal `~` was treated as relative and resolved against
  the project dir, producing `<project>/~/projects/demo`.
- **fix**: project-dir resolution never silently falls back to a path
  inside `~/.claude/plugins/cache/...`. Every strategy
  (`CLAUDE_REMOTE_MCP_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, MCP
  `roots/list`, `PWD`, `process.cwd()`) rejects plugin-cache paths and
  falls through. If every strategy fails, `spawn_remote_session` returns
  `INVALID_INPUT` with the full attempt log instead of silently mkdir-ing
  in the wrong place.
- **fix**: `git_init` now defaults to `true` so each spawned session
  starts in its own clean git repo (`git init -b main` + empty initial
  commit). Pass `git_init: false` to opt out. Worktree mode silently
  ignores the flag (it has no `.git` of its own).
- **change**: drop the pinned `version: "0.1.0"` trap and adopt semver
  bumps per release. `/plugin update` works again across releases.
- **add**: spawn response surfaces `project_dir_used` and
  `project_dir_source`; `check_remote_ready` exposes
  `orchestrator_project_dir`.
- **add**: `CLAUDE_REMOTE_MCP_PROJECT_DIR` env var as an explicit
  override for orchestrator project dir.

## 0.1.0 — 2026-05-16

Initial release. 8 MCP tools (check_remote_ready, spawn_remote_session,
list_remote_sessions, stop_remote_session, get_session_link,
install_plugin, install_mcp_server, merge_back_session). Single-plugin
marketplace at `hieutrtr`. Bundled `dist/server.js` (~760KB,
self-contained).
