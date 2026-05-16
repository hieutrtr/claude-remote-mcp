---
description: List Claude Remote Control sessions tracked in the local registry. Reconciles dead PIDs before showing.
argument-hint: [--all] [--tag <tag>]
---

Call the `list_remote_sessions` MCP tool from `claude-remote-mcp`.

Parse `$ARGUMENTS`:

- `--all` or `--include-dead` → set `only_alive: false`.
- `--cross-host` → set `include_other_hosts: true`.
- `--tag <t>` (repeatable) → collect into `filter_tags`.

Render the result as a compact table with columns:

- `session_id` (short form is fine)
- `name`
- `status` (alive/dead/stopped)
- `url`
- `working_dir`

If empty, say "no remote sessions" and remind the user they can spawn one
with `/spawn-remote <folder>`.
