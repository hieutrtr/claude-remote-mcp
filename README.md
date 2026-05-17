# claude-remote-mcp

A Claude Code plugin that lets one running Claude Code session **spawn and
manage Claude Remote Control sessions** on the same machine, then hand the
URL/QR off to mobile or web so you can keep working from another device.

The plugin handles the things mobile and web cannot do locally:

- create folders or git worktrees, optionally `git init` a fresh repo
- spawn detached `claude remote-control` processes
- install plugins and MCP servers (the `/plugin` and `/mcp` slash commands are
  local-only and cannot run from claude.ai/code or mobile)
- list, stop, and merge-back lifecycle

Steering the spawned session itself — chat, approvals, transcript — stays in
mobile / web. The plugin deliberately does **not** duplicate that.

See [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) for product framing and
[architecture.md](./architecture.md) for technical details.

## Requirements

- **Claude Code >= 2.1.51** (Remote Control requirement). Check with
  `claude --version`.
- **Node.js >= 20**.
- Claude Code subscription (Pro or Max; Team and Enterprise need an admin to
  enable the Remote Control toggle).
- Outbound HTTPS to `api.anthropic.com`.
- API-key auth is **not** supported by Remote Control. The plugin's
  pre-flight check enforces this.

## Install

The bundled `dist/server.js` is committed, so no `npm install` or build step
is needed to consume the plugin.

### Option A — Install via marketplace (recommended)

This repo doubles as a single-plugin marketplace
(`.claude-plugin/marketplace.json`). In any Claude Code session:

```text
/plugin marketplace add hieutrtr/claude-remote-mcp
/plugin install claude-remote-mcp@hieutrtr
```

Restart the session, or run `/reload-plugins`.

**Verified end-to-end**: `marketplace add` clones the GitHub repo, reads
`marketplace.json`, registers a marketplace named `hieutrtr`. `plugin install
claude-remote-mcp@hieutrtr` copies the plugin to
`~/.claude/plugins/cache/hieutrtr/claude-remote-mcp/<version>/`, records it
in `installed_plugins.json` pinned to the published `version` field in
`plugin.json` (and the git commit SHA as a fallback channel). Installed cache
is ~1.3 MB, not 90 MB, because an `.npmrc` with `omit=dev` keeps the runtime
build tools out of the user's cache.

### Option B — Local dev / test (no install)

For a single session without persisting an install:

```bash
git clone https://github.com/hieutrtr/claude-remote-mcp.git
claude --plugin-dir /absolute/path/to/claude-remote-mcp
```

The `--plugin-dir` flag loads the plugin for that session only. If you also
have it installed via marketplace, `--plugin-dir` takes precedence for that
session.

> `claude plugin install` does **not** accept a local path — it only resolves
> plugins from a configured marketplace (`name@marketplace` syntax). Use
> `--plugin-dir` for local-only testing.

## Quickstart

After install, plugin slash commands are namespaced as
`/claude-remote-mcp:<name>`:

```text
> /claude-remote-mcp:spawn-remote ./migrations name=alembic
```

**Absolute paths** (e.g. `/Users/you/myproject/demo`) bypass project-dir
resolution entirely for same-dir and session modes — they always land
exactly where you specify. Use them when you want a guarantee.

**Home-relative paths** (e.g. `~/projects/demo` or `~`) are expanded to
the current user's home directory before any resolution step, so they
behave the same as absolute paths. (The shell doesn't expand `~` for
arguments passed to MCP tools, so the plugin does it explicitly.)

**Relative paths** (e.g. `./demo`) resolve against the orchestrator
project directory, which the plugin determines through this chain
(first match that does NOT point inside the plugin install cache wins):

1. `CLAUDE_REMOTE_MCP_PROJECT_DIR` — explicit user override.
2. `CLAUDE_PROJECT_DIR` — set by Claude Code for MCP server subprocesses.
3. MCP `roots/list` request, when the client advertises the roots
   capability.
4. `$PWD` — the shell launcher's working directory.
5. `process.cwd()` — last resort.

Any entry that resolves to a path inside `~/.claude/plugins/cache/...`
is **rejected**, not silently used — the only ways the plugin will ever
mkdir into the plugin cache is if you pass an absolute path under it on
purpose. If every strategy fails, `spawn_remote_session` returns
`INVALID_INPUT` with a list of all attempted sources and the reason each
was rejected, instead of silently creating files in the wrong place.

The spawn response includes `project_dir_used` and `project_dir_source`,
and `check_remote_ready` exposes the same under
`orchestrator_project_dir`, so misconfiguration is immediately visible.

If resolution fails on your machine, set the override before launching
`claude`:

```bash
export CLAUDE_REMOTE_MCP_PROJECT_DIR="$PWD"
claude
```

The orchestrator session runs `check_remote_ready` first, then
`spawn_remote_session`. You get a `https://claude.ai/code/...` URL back; open
it on your phone or in another browser and keep chatting from there. The
orchestrator session can close — the spawned child is detached and stays
alive.

Other slash commands:

```text
> /claude-remote-mcp:list-remote                     # alive sessions only
> /claude-remote-mcp:list-remote --all               # include stopped/dead
> /claude-remote-mcp:stop-remote <session_id_or_pid>
```

You can also describe intent in natural language and Claude will call the
underlying MCP tools directly — `spawn_remote_session`,
`list_remote_sessions`, `stop_remote_session`, `check_remote_ready`,
`install_plugin`, `install_mcp_server`, `get_session_link`, or
`merge_back_session`.

### Fresh git repo per session (default)

`git_init` defaults to **`true`**. After `mkdir -p`, the plugin runs
`git init -b <git_init_branch>` (defaults to `main`) and creates an empty
initial commit so the spawned session has its own clean repo with a HEAD
ref out of the gate. Without this, the Claude mobile app would attach the
session to whatever ambient git context it could guess at.

If the target folder is already a git repo, init is skipped.

Pass `git_init: false` to opt out:

```text
> spawn a remote session at ./shared-folder with git_init=false
```

`git_init` is **silently ignored** when `spawn_mode: "worktree"` — a
worktree branches off an existing repo and has no `.git` of its own to
init.

### Worktree mode

When you want the spawned session to live in a parallel git worktree of your
current project, pass `spawn_mode: "worktree"`. The plugin runs `git worktree
add -b claude/<name> <folder>` against the repo at `$CLAUDE_PROJECT_DIR`, so
the worktree is anchored to **your** project — not the plugin's own git
history. After the spawned session is done, `merge_back_session` rebases,
merges, or squash-merges the worktree branch back into your target branch
and removes the worktree.

## MCP tools

| Tool | What it does |
| --- | --- |
| `check_remote_ready` | Run all pre-flight checks: claude binary present, version `>=2.1.51`, authenticated via claude.ai OAuth (not `oauth_token` or API key), workspace trusted, outbound HTTPS reachable, state dir writable, platform supports detached spawn. |
| `spawn_remote_session` | Create folder (and optionally `git init`, or a git worktree), spawn `claude remote-control` detached, tail its log for the session URL, register in the cross-session state file, return the URL. |
| `list_remote_sessions` | List tracked sessions on this host. Reconciles dead PIDs before returning so the listing reflects reality. |
| `stop_remote_session` | Stop a session by `session_id` or `pid`. SIGTERM → 5 s grace → SIGKILL. |
| `get_session_link` | Read-only re-fetch of the URL / QR / status for a previously spawned session. |
| `install_plugin` | Wrapper for `claude plugin install` (the `/plugin` slash command is local-only and cannot be invoked from mobile or web). |
| `install_mcp_server` | Wrapper for `claude mcp add`. Same rationale as `install_plugin`. Warns when env keys look like secrets. |
| `merge_back_session` | Merge commits from a worktree-mode session's branch into a target branch (`merge` / `rebase` / `squash`). Returns the conflict list on failure and leaves the repo untouched. |

## State

The plugin writes state to `~/.claude-remote-mcp/` (or
`$XDG_STATE_HOME/claude-remote-mcp/`, or `$CLAUDE_REMOTE_MCP_HOME` when set):

```
state.json       cross-session registry, file-locked
audit.log        JSONL append-only audit trail
logs/<sid>.log   stdout of each spawned remote child
```

This is shared across Claude Code sessions on the same host, so a different
session opened later can see and manage sessions spawned earlier.

## Environment variables

| Var | Default | Effect |
| --- | --- | --- |
| `CLAUDE_REMOTE_MCP_PROJECT_DIR` | unset | **Force-override** the orchestrator project root. Use this if `working_dir` in the spawn response shows the plugin install cache (`~/.claude/plugins/cache/...`) instead of your project. |
| `CLAUDE_PROJECT_DIR` | set by Claude Code | Project root used to resolve relative `folder` inputs and to locate the parent repo for worktree mode. The plugin reads this, not `process.cwd()`. |
| `CLAUDE_REMOTE_MCP_HOME` | `~/.claude-remote-mcp` | Override the data directory. |
| `CLAUDE_BIN` | resolved from PATH | Override the `claude` binary location. |
| `CLAUDE_REMOTE_MCP_URL_REGEX` | `https://claude\.ai/code/\S+` | Override the URL-parse regex if the upstream output format changes. |
| `CLAUDE_REMOTE_MCP_URL_TIMEOUT_MS` | `30000` | Timeout when tailing the child log for the session URL. |
| `CLAUDE_REMOTE_MCP_VERBOSE` | `false` | Verbose stderr logging from the MCP server. |

## Development

```bash
npm install --include=dev    # one-time, get build and test deps
npm run build                # typecheck + esbuild bundle to dist/server.js
npm run typecheck            # tsc --noEmit only
npm test                     # vitest (25 tests)
bash scripts/smoke.sh        # end-to-end MCP stdio smoke
```

> `--include=dev` is required because `.npmrc` sets `omit=dev` to keep
> `claude plugin install` from pulling ~90 MB of build tooling into every
> user's plugin cache. Without the override, `npm install` skips
> devDependencies and the build will fail.

The build produces a single self-contained `dist/server.js` (~760 KB) with
all runtime dependencies inlined. The bundle is committed so consumers don't
need to install dev tools.

The 25 tests cover paths, platform helpers, error model, file-locked registry
(including 100 parallel writes), URL tailer, end-to-end spawn/list/stop
against a fake `claude` binary, the `CLAUDE_PROJECT_DIR` path-resolution fix,
and the `git_init` flow.

## Layout

```
.claude-plugin/
  plugin.json         Claude Code plugin manifest
  marketplace.json    single-plugin marketplace catalog
dist/
  server.js           bundled MCP server (committed; no build needed by consumers)
commands/             3 namespaced slash commands (spawn / list / stop)
src/
  server.ts           MCP stdio entry
  paths.ts            data dir resolution + CLAUDE_PROJECT_DIR
  platform.ts         detach / pidAlive / gracefulKill
  registry.ts         state.json read/write with file lock
  audit.ts            JSONL audit log
  claudeCli.ts        wrapper around the `claude` binary
  git.ts              worktree + merge/rebase/squash + git init helpers
  urlTail.ts          poll log file for the Remote Control URL
  errors.ts           CrmError + ErrorCodes
  types.ts            Zod schemas
  preflight/          7 readiness checks
  tools/              8 MCP tools
test/unit/            5 unit test files
test/integration/     spawn integration with fake binary
tasks/                roadmap referencing ARCH-x.y sections
```

## License

MIT.
