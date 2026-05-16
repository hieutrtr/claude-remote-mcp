# claude-remote-mcp

A Claude Code plugin that lets a running Claude Code session **spawn and
manage Claude Remote Control sessions** on the local machine, then hand the
URL/QR off to mobile or web so you can keep working from another device.

The plugin handles the things mobile/web cannot do locally: creating folders
or git worktrees, spawning detached `claude remote-control` processes,
installing plugins and MCP servers (which the `/plugin` and `/mcp` slash
commands cannot do from claude.ai/code), and lifecycle/cleanup. Steering the
session itself (chat, approvals, transcript) stays with mobile/web — this
plugin deliberately does **not** duplicate that.

See [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) for product framing and
[architecture.md](./architecture.md) for technical details.

## Requirements

- **Claude Code >= 2.1.51** (Remote Control requirement). Check with
  `claude --version`.
- **Node.js >= 20**.
- Claude Code subscription (Pro/Max; Team/Enterprise need admin to enable
  the Remote Control toggle).
- Outbound HTTPS to `api.anthropic.com`.
- API-key auth is **not** supported by Remote Control.

## Install

### From source (during development)

```bash
git clone https://github.com/hieutrtr/claude-remote-mcp.git
cd claude-remote-mcp
npm install
npm run build
```

Then in any Claude Code session:

```text
/plugin install /absolute/path/to/claude-remote-mcp
```

### From marketplace (post-release)

```text
/plugin install claude-remote-mcp
```

## Quickstart

In a Claude Code session:

```text
> /spawn-remote ./migrations name=alembic
```

The orchestrator runs `check_remote_ready`, then `spawn_remote_session`. You
get a `https://claude.ai/code/...` URL back; open it on your phone and keep
chatting from there. The orchestrator session can close — the remote child
process is detached and stays alive.

Other commands:

```text
> /list-remote                    # show alive sessions
> /list-remote --all              # include stopped/dead
> /stop-remote <session_id_or_pid>
```

## MCP tools

| Tool | What it does |
| --- | --- |
| `check_remote_ready` | Run all pre-flight checks (binary, version, auth, trust, network, state, platform). |
| `spawn_remote_session` | Create folder/worktree, spawn `claude remote-control` detached, return URL. |
| `list_remote_sessions` | List tracked sessions, reconciling dead PIDs. |
| `stop_remote_session` | SIGTERM → SIGKILL fallback. |
| `get_session_link` | Re-fetch URL/QR for a session. |
| `install_plugin` | Wrap `claude plugin install` (since `/plugin` is local-only on mobile). |
| `install_mcp_server` | Wrap `claude mcp add` (since `/mcp` is local-only). |
| `merge_back_session` | Merge commits from a worktree-mode session back into a target branch. |

## State

The plugin writes state to `~/.claude-remote-mcp/` (or
`$XDG_STATE_HOME/claude-remote-mcp/`, or `$CLAUDE_REMOTE_MCP_HOME`):

```
state.json       cross-session registry (file-locked)
audit.log        JSONL append-only audit trail
logs/<sid>.log   stdout of each spawned remote child
```

This means a different Claude Code session opened later can see and
manage sessions spawned earlier.

## Environment variables

| Var | Default | Effect |
| --- | --- | --- |
| `CLAUDE_REMOTE_MCP_HOME` | `~/.claude-remote-mcp` | Override data dir. |
| `CLAUDE_BIN` | resolved from PATH | Override `claude` binary location. |
| `CLAUDE_REMOTE_MCP_URL_REGEX` | `https://claude\.ai/code/\S+` | Override URL parse regex. |
| `CLAUDE_REMOTE_MCP_URL_TIMEOUT_MS` | `30000` | URL-tail timeout. |
| `CLAUDE_REMOTE_MCP_VERBOSE` | `false` | Verbose stderr logging. |

## Development

```bash
npm run build       # tsc -> dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

22 tests cover paths, platform helpers, error model, file-locked registry
(including 100 parallel writes), URL tailer, and end-to-end spawn/list/stop
against a fake `claude` binary.

## Layout

```
src/
  server.ts           MCP stdio entry
  paths.ts            data dir resolution
  platform.ts         detach / pidAlive / gracefulKill
  registry.ts         state.json read/write with file lock
  audit.ts            JSONL audit log
  claudeCli.ts        wrapper around `claude` binary
  git.ts              worktree + merge/rebase/squash helpers
  urlTail.ts          poll log file for Remote Control URL
  errors.ts           CrmError + ErrorCodes
  types.ts            Zod schemas
  preflight/          7 readiness checks
  tools/              8 MCP tools
commands/             3 slash commands (spawn / list / stop)
test/unit/            5 unit test files
test/integration/     spawn integration with fake binary
tasks/                roadmap referencing ARCH-x.y sections
```

## License

MIT.
