# Changelog

All notable changes to claude-remote-mcp.

## 0.1.4 — 2026-05-17

- **fix**: switch from `--dangerously-skip-permissions` argv flag to
  `.claude/settings.local.json` with `permissions.defaultMode:
  "bypassPermissions"`. 0.1.3's per-subcommand flag works on some
  claude builds but not on others — the user reported
  `Error: Unknown argument: --dangerously-skip-permissions` against
  their claude. The settings file is version-stable and produces
  identical runtime behavior (every tool call auto-approved).
- The settings file is merged into any existing
  `.claude/settings.local.json` in the working dir, preserving other
  keys (e.g. `theme`, an existing `permissions.allow` list). Only
  `permissions.defaultMode` is overwritten.
- `dangerously_skip_permissions: false` now skips writing the settings
  file entirely, leaving the working dir untouched.
- 3 new integration tests for the settings.local.json flow: default
  write, key-preserving merge, skip-on-opt-out.

## 0.1.3 — 2026-05-17

- **fix**: argv ordering for the spawned `claude` process. In 0.1.2 the
  argv was `claude --dangerously-skip-permissions remote-control --name
  X ...`, which makes claude treat `remote-control` as a prompt to the
  interactive command and rejects every subsequent flag with
  `error: unknown option '--name'` (etc.). The fix is to put the
  subcommand first and let it own all flags:
  `claude remote-control --name X --spawn ... --dangerously-skip-permissions`.
  Verified by reproducing the error against claude 2.1.144.
- **deprecate**: `initial_prompt` on `spawn_remote_session`. The
  `claude remote-control` server subcommand does not accept an initial
  prompt — only the interactive `claude --remote-control "<name>"` form
  takes a positional value, and that value is the session NAME, not a
  prompt. Passing `initial_prompt` is now a no-op; the response
  includes a `notice` field pointing this out. Send the first message
  from claude.ai/code or the mobile app instead.

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
