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

The bundled `dist/server.js` is committed, so no `npm install` or build step
is needed to consume the plugin.

### Option A — Install via marketplace (recommended)

This repo doubles as a single-plugin marketplace (`.claude-plugin/marketplace.json`).
In any Claude Code session:

```text
/plugin marketplace add hieutrtr/claude-remote-mcp
/plugin install claude-remote-mcp@hieutrtr
```

Restart the session (or run `/reload-plugins`).

### Option B — Local dev / test (no install)

For a single session without persisting an install:

```bash
git clone https://github.com/hieutrtr/claude-remote-mcp.git
```

```bash
claude --plugin-dir /absolute/path/to/claude-remote-mcp
```

The `--plugin-dir` flag loads the plugin for that session only. If you also
have it installed via marketplace, `--plugin-dir` takes precedence.

> `claude plugin install` does **not** accept a local path — it only resolves
> plugins from a marketplace (`name@marketplace` syntax). Use `--plugin-dir`
> for local-only testing.

## Quickstart

After install, plugin skills are namespaced as `/claude-remote-mcp:<name>`:

```text
> /claude-remote-mcp:spawn-remote ./migrations name=alembic
```

Folder paths resolve against `$CLAUDE_PROJECT_DIR` (the directory you launched
`claude` from), **not** the plugin install location. So `./migrations` always
lands inside your project, never inside the plugin cache.

### Fresh git repo per session

Pass `git_init: true` to make the spawned session's folder its own git repo
(runs `git init -b main` and creates an empty initial commit after `mkdir`):

```text
> hãy spawn 1 remote session ở ./demo-project với git_init=true
```

This is mutually exclusive with `spawn_mode: "worktree"` — a worktree is a
branch off an existing repo, while `git_init` creates a fresh one.

The orchestrator runs `check_remote_ready` first, then `spawn_remote_session`.
You get a `https://claude.ai/code/...` URL back; open it on your phone and keep
chatting from there. The orchestrator session can close — the remote child is
detached and stays alive.

Other commands:

```text
> /claude-remote-mcp:list-remote                     # show alive sessions
> /claude-remote-mcp:list-remote --all               # include stopped/dead
> /claude-remote-mcp:stop-remote <session_id_or_pid>
```

You can also describe the intent in natural language and Claude will call
the underlying MCP tools (`spawn_remote_session`, `list_remote_sessions`,
`stop_remote_session`, `check_remote_ready`, `install_plugin`,
`install_mcp_server`, `get_session_link`, `merge_back_session`) directly.

## MCP tools

| Tool | What it does |
| --- | --- |
| `check_remote_ready` | Run all pre-flight checks (binary, version, auth, trust, network, state, platform). |
| `spawn_remote_session` | Create folder/worktree, optionally `git init` for a fresh repo, spawn `claude remote-control` detached, return URL. |
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
npm install --include=dev  # one-time, get build/test deps
npm run build              # typecheck + esbuild bundle to dist/server.js
npm run typecheck          # tsc --noEmit only
npm test                   # vitest (22 tests)
bash scripts/smoke.sh      # end-to-end MCP stdio smoke
```

> The `--include=dev` flag is needed because `.npmrc` sets `omit=dev`
> (which prevents `claude plugin install` from pulling ~90MB of build
> tooling into every user's plugin cache). Without it, `npm install`
> skips devDependencies and the build will fail.

The build produces a single self-contained `dist/server.js` (≈ 760KB) with
all runtime dependencies inlined. The bundle is committed so consumers
don't need to install dev tools.

22 tests cover paths, platform helpers, error model, file-locked registry
(including 100 parallel writes), URL tailer, and end-to-end spawn/list/stop
against a fake `claude` binary.

## Layout

```
.claude-plugin/
  plugin.json         Claude Code plugin manifest
  marketplace.json    single-plugin marketplace catalog
dist/
  server.js           bundled MCP server (committed, no build needed by consumers)
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
