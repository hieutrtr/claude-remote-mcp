# Architecture — claude-remote-mcp

Tài liệu kiến trúc dành cho coding agent (và người) làm việc trên repo. Mỗi
section có ID ổn định (`ARCH-x.y`) để các file task có thể reference. Ví dụ:
> *"Implement spawn_remote_session theo ARCH-6.1, dùng platform helper ở
> ARCH-8.1, audit theo ARCH-5."*

Tham chiếu sản phẩm: [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md).

---

## ARCH-1 — System overview

`claude-remote-mcp` là Claude Code plugin bao gồm:

- **1 MCP server** (Node 20+/TypeScript) chạy stdio, được Claude Code spawn
  theo plugin spec.
- **8 MCP tool** ([ARCH-6](#arch-6--tool-implementations)) cho bootstrap và
  lifecycle.
- **Shared state file** ở `~/.claude-remote-mcp/state.json`
  ([ARCH-4](#arch-4--state-registry)) đảm bảo cross-session visibility.
- **Append-only audit log** ([ARCH-5](#arch-5--audit-log)).
- **3 slash command** alias ([ARCH-9.2](#arch-92--slash-commands)).

### ARCH-1.1 — High-level diagram

```
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ Claude Code session A       │  │ Claude Code session B       │
│  (terminal 1, hôm sáng)     │  │  (terminal 2, hôm tối)      │
│                             │  │                             │
│  ├─ MCP client (built-in)   │  │  ├─ MCP client (built-in)   │
│  └─ MCP server (per-process)│  │  └─ MCP server (per-process)│
│       │                     │  │       │                     │
└───────┼─────────────────────┘  └───────┼─────────────────────┘
        │                                │
        └──────────┐         ┌───────────┘
                   ▼         ▼
            ┌───────────────────────┐
            │ ~/.claude-remote-mcp/ │
            │   state.json (lock)   │ ◄── ARCH-4
            │   audit.log           │ ◄── ARCH-5
            │   logs/<sid>.log      │ ◄── ARCH-12.2
            └─────────┬─────────────┘
                      │
                      ▼ spawn / track / kill
            ┌───────────────────────┐
            │ claude remote-control │  child detached (ARCH-3.2)
            │ (in target folder)    │  outlives parent
            └─────────┬─────────────┘
                      │ outbound HTTPS only
                      ▼
                Anthropic API
                      │
                      ▼
          claude.ai/code  +  Claude mobile app
```

### ARCH-1.2 — Trust boundaries

- **Inside trust**: Claude Code session, MCP server process, state file, child
  `claude` processes. Tất cả chạy under cùng OS user.
- **Outside trust**: marketplace plugin metadata, env vars do user truyền vào,
  remote URLs do `claude remote-control` in ra. Phải validate / sanitize trước
  khi log hoặc shell out.

### ARCH-1.3 — Non-responsibilities

Plugin **không** làm những việc sau (xem [PRODUCT_BRIEF §2](./PRODUCT_BRIEF.md#2-phân-vai-plugin-vs-mobile)):

- Gửi prompt vào remote session đang chạy.
- Đọc transcript của remote session.
- Authenticate Claude account.
- UI dashboard.
- Quản lý session ở máy khác.

---

## ARCH-2 — Runtime model

### ARCH-2.1 — Per-session MCP server

Theo Claude Code plugin spec, mỗi Claude Code session khi load plugin sẽ
spawn 1 instance MCP server **của riêng nó**. Nghĩa là:

- 3 terminal mở Claude Code song song ⇒ 3 process MCP server.
- Đóng terminal ⇒ MCP server tương ứng exit.
- MCP server **không** là daemon hệ thống.

Hệ quả: **state không được giữ trong RAM của MCP server**. Mọi thứ cần share
giữa các session phải đi qua filesystem ([ARCH-4](#arch-4--state-registry)).

### ARCH-2.2 — Stateless tool handlers

Mỗi tool handler MUST:

1. Read state file dưới shared lock nếu cần đọc.
2. Read-modify-write dưới exclusive lock nếu cần mutate.
3. Không lưu state instance trong process memory (chỉ cache transient trong 1
   tool call).

### ARCH-2.3 — Process families

Có 3 loại process cần phân biệt rõ:

| Loại | Owner | Lifecycle |
| --- | --- | --- |
| **Orchestrator** | User terminal | Claude Code CLI / Desktop process. |
| **MCP server** | Claude Code spawn | Sống đúng bằng orchestrator. |
| **Remote child** | MCP server spawn | Detached, sống độc lập, tự exit khi user `/exit` ở remote hoặc bị `stop_remote_session`. |

---

## ARCH-3 — Process lifecycle

### ARCH-3.1 — MCP server lifecycle

- **Start**: Claude Code spawn `node dist/server.js` qua stdio.
- **Init**: load state file (read-only), reconcile PID liveness
  ([ARCH-4.5](#arch-45--reconciliation)), không mutate trừ khi cần đánh dấu
  `status: dead`.
- **Serve**: handle MCP tool calls.
- **Shutdown**: exit khi stdio đóng. Không cần cleanup gì (state đã persist
  sau mỗi mutation).

### ARCH-3.2 — Remote child lifecycle

Khi `spawn_remote_session` chạy:

1. `mkdir -p <folder>` nếu chưa tồn tại.
2. Mở file log `~/.claude-remote-mcp/logs/<session_id>.log` với mode append.
3. Spawn `claude remote-control [--name <name>] [--spawn <mode>] [--sandbox]`
   với:
   - `cwd = <folder>`
   - `stdio = ['ignore', logFd, logFd]`
   - **Detach** theo [ARCH-8.1](#arch-81--detach):
     - Unix: `detached: true`, gọi `child.unref()` sau spawn. Optionally
       wrap với `setsid` để break controlling terminal.
     - Windows: `detached: true`, `windowsHide: true`, `child.unref()`.
4. Tail file log đến khi match URL regex (mặc định
   `/https:\/\/claude\.ai\/code\/\S+/`) **hoặc** timeout 30s.
5. Append entry vào state ([ARCH-4.2](#arch-42--schema)) với `pid`, `url`,
   `started_at`, `working_dir`, `name`, `spawn_mode`, `tags`,
   `owner_orchestrator_pid` (PID của Claude Code đã gọi tool — không phải
   MCP server PID).
6. Trả output về cho tool caller ([ARCH-6.1](#arch-61--spawn_remote_session)).

**Detach success criterion** (test M1): orchestrator + MCP server bị kill,
child vẫn online trên `claude.ai/code`. PID vẫn alive sau 60s.

### ARCH-3.3 — Stop flow

`stop_remote_session(session_id | pid)`:

1. Acquire exclusive lock trên state.
2. Resolve `pid` từ state.
3. `process.kill(pid, 'SIGTERM')`.
4. Poll alive mỗi 250ms, max 5s.
5. Nếu vẫn alive: `SIGKILL`.
6. Update state: `status: stopped`, `stopped_at: <iso>`.
7. Release lock.
8. Append audit event.

### ARCH-3.4 — Orphan & zombie reclamation

Reconciliation chạy:

- Tại MCP server startup.
- Tại mỗi `list_remote_sessions` call (xem [ARCH-6.2](#arch-62--list_remote_sessions)).

Logic:

```
for entry in state.sessions:
  if entry.status in ('stopped', 'dead'): continue
  if not pid_alive(entry.pid):
    entry.status = 'dead'
    entry.died_at = now()
    write_state()
    audit('session_died', entry)
```

PID alive check qua `process.kill(pid, 0)` ([ARCH-8.2](#arch-82--pid-alive-check)).

---

## ARCH-4 — State registry

### ARCH-4.1 — Location

```
$XDG_STATE_HOME/claude-remote-mcp/state.json
  → fallback: ~/.claude-remote-mcp/state.json (mọi OS)
```

Hard-code path qua module `src/paths.ts`. Permissions: `0600` (chỉ owner đọc).

### ARCH-4.2 — Schema

```json
{
  "schema_version": 1,
  "sessions": [
    {
      "session_id": "myhost-graceful-unicorn",
      "name": "migrations",
      "url": "https://claude.ai/code/abc...",
      "qr_ascii": "...",
      "pid": 12345,
      "working_dir": "/abs/path",
      "spawn_mode": "worktree",
      "worktree_branch": "claude/migrations",
      "sandbox": false,
      "tags": ["morning-fanout"],
      "owner_orchestrator_pid": 4321,
      "owner_hostname": "myhost",
      "started_at": "2026-05-15T10:00:00.000Z",
      "stopped_at": null,
      "died_at": null,
      "status": "alive"
    }
  ]
}
```

`status` enum: `alive | stopped | dead`.

Type definitions ở `src/types.ts`. Migration giữa `schema_version` qua hàm
`migrate(state)` ở `src/registry.ts`.

### ARCH-4.3 — Locking protocol

Dùng `proper-lockfile` (npm) hoặc tương đương. Mọi mutation phải:

```ts
await lock('state.json', { retries: { retries: 10, factor: 1.5, minTimeout: 50 }});
try {
  const state = readState();      // sync, atomic
  const next = mutate(state);
  await writeStateAtomic(next);   // ARCH-4.4
} finally {
  await unlock('state.json');
}
```

Read-only path (vd `get_session_link`) có thể read không lock — chấp nhận
read-after-write race nhẹ vì state file là source of truth, không phải cache.

### ARCH-4.4 — Atomic write

```
write(state.json.tmp, content)
fsync(state.json.tmp)
rename(state.json.tmp, state.json)   # atomic trên POSIX và NTFS
```

Phải dùng `fs.renameSync` (không qua copy-then-delete) để giữ atomicity.

### ARCH-4.5 — Reconciliation

Xem [ARCH-3.4](#arch-34--orphan--zombie-reclamation). Reconciliation **không**
xoá entry — chỉ chuyển `status`. Quyết định xoá hẳn để tool `prune` (future,
out of v1).

### ARCH-4.6 — Concurrency invariants

- 2 MCP server cùng cài `spawn_remote_session` ở 2 terminal khác nhau MUST
  không gây mất entry hoặc duplicate `session_id`.
- `session_id` được sinh **bên trong lock** dựa trên format
  `<hostname>-<adjective>-<noun>` (random từ wordlist; collision => retry).

---

## ARCH-5 — Audit log

### ARCH-5.1 — Path & format

```
~/.claude-remote-mcp/audit.log
```

JSONL, append-only. Mỗi line:

```json
{"ts":"2026-05-15T10:00:00.000Z","event":"session_spawned","session_id":"...","by_orchestrator_pid":4321,"data":{...}}
```

### ARCH-5.2 — Events

| Event | Trigger |
| --- | --- |
| `session_spawned` | `spawn_remote_session` thành công |
| `session_spawn_failed` | `spawn_remote_session` lỗi |
| `session_stopped` | `stop_remote_session` |
| `session_died` | Reconciliation phát hiện PID chết |
| `plugin_installed` | `install_plugin` thành công |
| `mcp_server_installed` | `install_mcp_server` thành công |
| `session_merged_back` | `merge_back_session` |
| `preflight_run` | `check_remote_ready` |

### ARCH-5.3 — Rotation

V1: không rotate. Document rằng audit log có thể grow. V2 cân nhắc rotate khi
> 50MB.

---

## ARCH-6 — Tool implementations

Mỗi tool handler ở `src/tools/<name>.ts`, export:

```ts
export const definition: ToolDefinition;
export async function handler(input: I): Promise<O>;
```

Định nghĩa schema input/output dùng Zod (`src/types.ts`). Lỗi return qua
structured error ([ARCH-10](#arch-10--error-model)).

### ARCH-6.1 — `spawn_remote_session`

**Input** (Zod):

```ts
z.object({
  folder: z.string().min(1),
  name: z.string().optional(),
  spawn_mode: z.enum(['same-dir', 'worktree', 'session']).default('same-dir'),
  worktree_branch: z.string().optional(),
  sandbox: z.boolean().optional(),
  initial_prompt: z.string().optional(),
  tags: z.array(z.string()).default([]),
})
```

**Output**: xem [ARCH-4.2](#arch-42--schema) entry shape (omit `status`,
`stopped_at`, `died_at`).

**Algorithm**:

1. Resolve `folder` qua `path.resolve(process.cwd(), input.folder)`.
2. Nếu `spawn_mode === 'worktree'`:
   - Verify cwd là git repo.
   - `git worktree add <folder> -b <branch>` (branch = `input.worktree_branch
     ?? "claude/" + name`).
3. Else `mkdir -p folder`.
4. Generate `session_id` ([ARCH-4.6](#arch-46--concurrency-invariants)).
5. Build argv: `claude` + optional `--remote-control "<initial_prompt>"` nếu
   có (xem [ARCH-7.2](#arch-72--commands-wrapped)) **hoặc** `remote-control`
   nếu không có `initial_prompt`. Thêm `--name`, `--spawn`, `--sandbox` tương
   ứng.
6. Spawn detached ([ARCH-8.1](#arch-81--detach)) với `cwd: folder`,
   `stdio: ['ignore', logFd, logFd]`.
7. Tail log file đến khi URL regex match (timeout 30s).
8. Acquire state lock, append entry, release.
9. Audit `session_spawned`.
10. Return entry.

**Error codes**: `WORKSPACE_NOT_TRUSTED`, `URL_TIMEOUT`, `WORKTREE_FAILED`,
`CLAUDE_NOT_FOUND`, `VERSION_TOO_OLD`.

### ARCH-6.2 — `list_remote_sessions`

**Input**:

```ts
z.object({
  filter_tags: z.array(z.string()).optional(),
  only_alive: z.boolean().default(true),
  include_other_hosts: z.boolean().default(false),
})
```

**Algorithm**:

1. Reconcile ([ARCH-3.4](#arch-34--orphan--zombie-reclamation)) under lock.
2. Read state.
3. Filter:
   - `only_alive` ⇒ `status === 'alive'`.
   - `filter_tags` ⇒ entry phải chứa **mọi** tag (AND, không phải OR).
   - `include_other_hosts === false` ⇒ chỉ entry có `owner_hostname === os.hostname()`.
4. Return array.

### ARCH-6.3 — `stop_remote_session`

**Input**:

```ts
z.object({
  session_id: z.string().optional(),
  pid: z.number().int().optional(),
}).refine(d => d.session_id || d.pid, 'cần session_id hoặc pid')
```

**Algorithm**: xem [ARCH-3.3](#arch-33--stop-flow).

**Error codes**: `SESSION_NOT_FOUND`, `KILL_FAILED`.

### ARCH-6.4 — `get_session_link`

**Input**: `{ session_id: string }`.

**Output**: `{ url: string, qr_ascii: string, status: string }`.

Read-only, không cần lock.

### ARCH-6.5 — `install_plugin`

**Input**:

```ts
z.object({
  plugin: z.string(),
  scope: z.enum(['user', 'project', 'local']).default('project'),
  marketplace: z.string().url().optional(),
})
```

**Algorithm**:

1. Pre-flight: `claude` available và version OK (gọi
   [ARCH-7.2](#arch-72--commands-wrapped)).
2. Build argv: `claude plugin install <plugin> [--scope <scope>] [--marketplace <url>]`.
3. Spawn (foreground, capture stdout/stderr).
4. Parse output để xác định installed version.
5. Audit.
6. Return `{ installed: true, plugin, scope, version }`.

**Error codes**: `PLUGIN_INSTALL_FAILED`, `WORKSPACE_NOT_TRUSTED`,
`CLAUDE_NOT_FOUND`.

### ARCH-6.6 — `install_mcp_server`

**Input**:

```ts
z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  scope: z.enum(['user', 'project', 'local']).default('project'),
})
```

**Algorithm**:

1. Cảnh báo nếu `env` key trông giống secret (regex `/(KEY|TOKEN|SECRET|PASSWORD)/i`)
   — thêm field `warnings` vào output.
2. Wrap `claude mcp add` ([ARCH-7.2](#arch-72--commands-wrapped)).
3. Audit.

### ARCH-6.7 — `merge_back_session`

**Input**:

```ts
z.object({
  session_id: z.string(),
  target_branch: z.string(),
  strategy: z.enum(['merge', 'rebase', 'squash']).default('rebase'),
  remove_worktree: z.boolean().default(true),
})
```

**Algorithm**:

1. Load entry, verify `spawn_mode === 'worktree'`. Else fail
   `NOT_A_WORKTREE_SESSION`.
2. Stop session nếu alive ([ARCH-6.3](#arch-63--stop_remote_session)).
3. Verify worktree clean (`git status --porcelain` empty trong worktree dir).
   Else fail `WORKTREE_DIRTY` — không tự stash, để user xử lý.
4. Switch sang `target_branch` ở repo gốc.
5. Strategy:
   - `merge`: `git merge --no-ff <worktree_branch>`
   - `rebase`: `git rebase <worktree_branch>` rồi `git checkout target` ... (cần
     verify cách chuẩn — implement note: thực tế là rebase commits của
     worktree branch lên target). Cụ thể trong source.
   - `squash`: `git merge --squash <worktree_branch>` rồi `git commit -m "<auto>"`.
6. Nếu conflict ⇒ abort thao tác hiện tại, fail `MERGE_CONFLICT` với danh sách
   file conflict.
7. Nếu success và `remove_worktree`:
   - `git worktree remove <worktree_dir>`
   - `git branch -d <worktree_branch>`
8. Audit `session_merged_back`.

**Error codes**: `NOT_A_WORKTREE_SESSION`, `WORKTREE_DIRTY`, `MERGE_CONFLICT`,
`WORKTREE_REMOVE_FAILED`.

### ARCH-6.8 — `check_remote_ready`

**Input**: `{}`.

**Algorithm**: chạy tất cả check song song (Promise.all), trả về structured:

```json
{
  "ok": false,
  "checks": {
    "claude_present":          {"ok": true, "value": "/usr/local/bin/claude"},
    "claude_version":          {"ok": true, "value": "2.1.110", "required": "2.1.51"},
    "authenticated":           {"ok": true, "method": "claude.ai"},
    "org_remote_control":      {"ok": false, "reason": "ADMIN_TOGGLE_OFF"},
    "workspace_trusted":       {"ok": true, "folder": "/cwd"},
    "outbound_https":          {"ok": true},
    "state_writable":          {"ok": true, "path": "..."},
    "platform_detach_support": {"ok": true, "platform": "linux"}
  },
  "blocking": ["org_remote_control"]
}
```

Mỗi sub-check là 1 function ở `src/preflight/<name>.ts`. Test riêng từng cái.

**Check details**:

- `claude_present`: `which claude` / `where claude`.
- `claude_version`: `claude --version`, parse semver, compare `>= 2.1.51`.
- `authenticated`: chạy `claude auth status` (trả JSON
  `{loggedIn, authMethod, apiProvider}`). Reject:
  - `ANTHROPIC_API_KEY` env set ⇒ API key không support Remote Control.
  - `CLAUDE_CODE_OAUTH_TOKEN` env set hoặc `authMethod === "oauth_token"` ⇒
    long-lived token chỉ inference-only.
  - `apiProvider !== "firstParty"` ⇒ Bedrock/Vertex/Foundry không support.
- `org_remote_control`: **không** có trong v1 — không có CLI flag hữu ích để
  kiểm tra trước; fail sẽ xảy ra tự nhiên ở `spawn_remote_session` lần đầu
  với message từ `claude remote-control` stderr.
- `workspace_trusted`: đọc `~/.claude.json`, key `projects[<abs_folder>].hasTrustDialogAccepted`.
- `outbound_https`: HEAD https://api.anthropic.com với timeout 3s.
- `state_writable`: stat dir + write test file.
- `platform_detach_support`: `os.platform() in ['linux','darwin','win32']`.

---

## ARCH-7 — Claude CLI wrapper

### ARCH-7.1 — Module location

`src/claudeCli.ts`. Mọi shell call tới `claude` đi qua đây — không scatter
`spawn('claude', ...)` khắp codebase.

### ARCH-7.2 — Commands wrapped

```ts
resolveClaudeBin(): string                                // ARCH-7.3 path resolution
runClaude(args, opts): Promise<RunResult>                 // generic foreground exec
claudeVersion(): Promise<string>                          // parse `claude --version`
claudePluginInstall(opts): Promise<{stdout, version|null}>// ARCH-6.5
claudeMcpAdd(opts): Promise<{stdout}>                     // ARCH-6.6
// auth status is consumed directly inside src/preflight/authenticated.ts
// (calls `runClaude(["auth","status"])`, parses JSON
//  {loggedIn, authMethod, apiProvider}).
// spawn of `claude remote-control` is done in src/platform.ts spawnDetached.
```

Tất cả return structured, không trả raw stdout cho caller.

### ARCH-7.3 — Path resolution

Resolve `claude` binary qua:

1. `process.env.CLAUDE_BIN` nếu set.
2. `which claude` (Unix) / `where.exe claude` (Windows).
3. Common fallback paths (`/usr/local/bin`, `~/.local/bin`, ...).

Cache path trong process memory cho calls sau (per-MCP-server).

---

## ARCH-8 — Platform abstraction

`src/platform.ts` — mọi OS-specific code tập trung ở đây. Module export
async functions, không phụ thuộc test framework.

### ARCH-8.1 — Detach

```ts
spawnDetached(cmd: string, args: string[], opts: {cwd, logFd}): ChildProcess
```

Implementation:

```ts
const child = child_process.spawn(cmd, args, {
  cwd: opts.cwd,
  stdio: ['ignore', opts.logFd, opts.logFd],
  detached: true,
  windowsHide: true,
});
child.unref();
return child;
```

**Linux/macOS**: `detached: true` tạo process group mới, đủ để con sống sau
khi parent chết. Không cần `setsid` external trừ khi gặp vấn đề controlling
terminal — verify khi spike M1.

**Windows**: `detached: true` + `windowsHide` đủ. Nếu thấy console window
flash, thêm `shell: false`.

### ARCH-8.2 — PID alive check

```ts
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);  // signal 0 = check only
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    if (err.code === 'EPERM') return true;  // exists but not ours
    throw err;
  }
}
```

### ARCH-8.3 — Kill

```ts
async function gracefulKill(pid: number, timeoutMs = 5000): Promise<void> {
  process.kill(pid, 'SIGTERM');
  // poll every 250ms
  // if still alive after timeout: process.kill(pid, 'SIGKILL')
}
```

Windows: `SIGTERM` được Node map sang `TerminateProcess` — acceptable cho v1.

### ARCH-8.4 — Path utilities

- `xdgStateHome()` → `process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.claude-remote-mcp')`.
- `stateFilePath()`, `auditLogPath()`, `childLogPath(sessionId)`.

---

## ARCH-9 — Plugin manifest & slash commands

### ARCH-9.1 — `.claude-plugin/plugin.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "claude-remote-mcp",
  "version": "0.1.0",
  "description": "Spawn and manage Claude Remote Control sessions from inside a Claude Code session.",
  "license": "MIT",
  "homepage": "https://github.com/hieutrtr/claude-remote-mcp",
  "repository": "https://github.com/hieutrtr/claude-remote-mcp",
  "keywords": ["remote-control", "mcp", "orchestrator", "worktree", "remote-session"],
  "mcpServers": {
    "claude-remote-mcp": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"]
    }
  }
}
```

Notes:

- The variable name is **`${CLAUDE_PLUGIN_ROOT}`** (NOT `${pluginDir}` — that
  is not a real Claude Code substitution).
- The `commands/` directory at plugin root is **auto-discovered**; no need to
  list each file in the manifest.
- Plugin root = repo root, **not** `.claude-plugin/`. All component
  directories (`commands/`, `agents/`, `hooks/`, `skills/`, `bin/`) live at
  repo root; only `plugin.json` lives inside `.claude-plugin/`.
- There is **no `requires` field** in the official schema. Minimum Claude
  Code version is enforced at runtime by the MCP server (preflight check).

### ARCH-9.2 — Slash commands

Đặt ở `commands/*.md`. Mỗi file là prompt template, agent đọc rồi gọi MCP
tool tương ứng.

- `/spawn-remote <folder>` → gọi `spawn_remote_session`.
- `/list-remote` → gọi `list_remote_sessions`.
- `/stop-remote <id_or_pid>` → gọi `stop_remote_session`.

Slash command **chỉ là syntactic sugar**. Agent vẫn có thể gọi tool trực
tiếp khi user mô tả ý định bằng natural language.

---

## ARCH-10 — Error model

### ARCH-10.1 — Structure

Mọi tool error trả về dưới dạng MCP error response với body:

```json
{
  "code": "WORKSPACE_NOT_TRUSTED",
  "message": "Folder /abs/path is not workspace-trusted. Run `claude` in that folder once to accept trust dialog.",
  "details": {"folder": "/abs/path"},
  "remediation": "..."
}
```

Code là enum string ổn định. Agent có thể switch case theo code để hành xử
khác nhau.

### ARCH-10.2 — Error code registry

Bảng codes (giữ trong `src/errors.ts`):

| Code | Source | Khi nào |
| --- | --- | --- |
| `CLAUDE_NOT_FOUND` | ARCH-7.3 | Không tìm thấy binary `claude`. |
| `VERSION_TOO_OLD` | ARCH-6.8 | `< 2.1.51`. |
| `NOT_AUTHENTICATED` | ARCH-6.8 | Chưa `claude /login`. |
| `WORKSPACE_NOT_TRUSTED` | ARCH-6.1 | Folder chưa trust. |
| `URL_TIMEOUT` | ARCH-6.1 | 30s không match URL regex. |
| `WORKTREE_FAILED` | ARCH-6.1 | `git worktree add` lỗi. |
| `WORKTREE_DIRTY` | ARCH-6.7 | Worktree có uncommitted changes. |
| `NOT_A_WORKTREE_SESSION` | ARCH-6.7 | Session không spawn bằng worktree mode. |
| `MERGE_CONFLICT` | ARCH-6.7 | Conflict trong merge/rebase. |
| `SESSION_NOT_FOUND` | ARCH-6.3, 6.4, 6.7 | Không có entry trong state. |
| `KILL_FAILED` | ARCH-6.3 | Kill timeout cả `SIGTERM` + `SIGKILL`. |
| `PLUGIN_INSTALL_FAILED` | ARCH-6.5 | `claude plugin install` exit nonzero. |
| `MCP_ADD_FAILED` | ARCH-6.6 | `claude mcp add` exit nonzero. |
| `STATE_LOCK_TIMEOUT` | ARCH-4.3 | Lock contention quá lâu. |

---

## ARCH-11 — Configuration

### ARCH-11.1 — Env vars

| Var | Default | Tác dụng |
| --- | --- | --- |
| `CLAUDE_REMOTE_MCP_HOME` | `$XDG_STATE_HOME/claude-remote-mcp` hoặc `~/.claude-remote-mcp` | Override toàn bộ data dir. |
| `CLAUDE_BIN` | resolved qua PATH | Override path tới `claude` binary. |
| `CLAUDE_REMOTE_MCP_URL_REGEX` | `https://claude\.ai/code/\S+` | Override regex parse URL nếu format đổi. |
| `CLAUDE_REMOTE_MCP_URL_TIMEOUT_MS` | `30000` | Timeout chờ URL. |
| `CLAUDE_REMOTE_MCP_VERBOSE` | `false` | Verbose logging ra stderr. |

### ARCH-11.2 — No config file in v1

Không có config file riêng. Mọi thứ đi qua env vars hoặc tool inputs. Tránh
proliferation của TOML/YAML.

---

## ARCH-12 — Logging & observability

### ARCH-12.1 — MCP server logs

- Default: chỉ log error qua stderr.
- `CLAUDE_REMOTE_MCP_VERBOSE=true`: log mỗi tool call (name + duration +
  result code) qua stderr ở format JSON 1 line.
- **Không** log input/output đầy đủ (có thể chứa secret từ `install_mcp_server.env`).

### ARCH-12.2 — Child stdout/stderr

Mỗi remote child có file log riêng:
`$CLAUDE_REMOTE_MCP_HOME/logs/<session_id>.log`. Mode append. Không rotate
trong v1.

### ARCH-12.3 — Audit log

Xem [ARCH-5](#arch-5--audit-log).

---

## ARCH-13 — Testing strategy

### ARCH-13.1 — Unit

- `src/registry.ts`: file lock + atomic write với fake fs.
- `src/platform.ts`: PID alive check, kill flow (mock `process.kill`).
- `src/claudeCli.ts`: command building (no real `claude` spawn).
- Mỗi `tools/*`: input validation, error mapping (mock `claudeCli`).

Framework: `vitest`.

### ARCH-13.2 — Integration

- Spawn thật `claude remote-control` (skip nếu không có binary trên CI runner).
- Test detach: spawn → kill parent process → assert child PID vẫn alive sau
  60s → cleanup.
- Test concurrent `spawn_remote_session` từ 2 process song song → assert
  không corrupt state.

### ARCH-13.3 — Cross-platform

CI matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`. Một số test
chỉ Unix (`setsid`), skip có điều kiện.

### ARCH-13.4 — Manual smoke

`scripts/smoke.sh` chạy end-to-end: install plugin → spawn → list → stop →
verify state clean.

---

## ARCH-14 — Repo layout

```
claude-remote-mcp/
├── .claude-plugin/
│   ├── plugin.json              # ARCH-9.1
│   └── marketplace.json         # single-plugin marketplace catalog
├── dist/
│   └── server.js                # esbuild bundle (committed)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── commands/                    # ARCH-9.2 (auto-discovered)
│   ├── spawn-remote.md
│   ├── list-remote.md
│   └── stop-remote.md
├── scripts/
│   ├── bundle.mjs               # esbuild entry
│   └── smoke.sh                 # end-to-end MCP stdio smoke
├── src/
│   ├── server.ts                # MCP entry, stdio bootstrap
│   ├── types.ts                 # Zod schemas + TS types (ARCH-4.2)
│   ├── errors.ts                # ARCH-10.2
│   ├── paths.ts                 # ARCH-8.4
│   ├── platform.ts              # ARCH-8
│   ├── registry.ts              # ARCH-4
│   ├── audit.ts                 # ARCH-5
│   ├── claudeCli.ts             # ARCH-7
│   ├── preflight/
│   │   ├── index.ts
│   │   ├── claudePresent.ts
│   │   ├── claudeVersion.ts
│   │   ├── authenticated.ts
│   │   ├── workspaceTrusted.ts
│   │   └── outboundHttps.ts
│   └── tools/                   # ARCH-6
│       ├── spawnRemote.ts
│       ├── listSessions.ts
│       ├── stopSession.ts
│       ├── getSessionLink.ts
│       ├── installPlugin.ts
│       ├── installMcpServer.ts
│       ├── mergeBackSession.ts
│       └── checkRemoteReady.ts
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── scripts/
│   └── smoke.sh
├── PRODUCT_BRIEF.md
└── architecture.md             # tài liệu này
```

---

## ARCH-15 — Dependencies

V1 dependencies tối thiểu:

- `@modelcontextprotocol/sdk` — MCP server SDK.
- `zod` — schema validation.
- `proper-lockfile` — file lock (ARCH-4.3).
- `semver` — version compare (ARCH-6.8).

Dev:

- `typescript`, `vitest`, `esbuild`, `@types/node`,
  `@types/proper-lockfile`, `@types/semver`.

`esbuild` bundles the server into a single self-contained `dist/server.js`
(~760KB, all runtime deps inlined). The bundle is committed so plugin
consumers don't need `npm install`.

**Không** thêm: heavy logging framework, ORM, HTTP server, web UI. Plugin
phải nhẹ.

---

## ARCH-16 — Decisions log (rationale)

Để coding agent không bị cám dỗ reverse những quyết định này:

| Decision | Lý do |
| --- | --- |
| MCP server thay vì pure slash command | Cần cross-session state ([ARCH-2.1](#arch-21--per-session-mcp-server)), file lock, cross-platform detach — không gọn nếu chỉ bash. |
| State qua file thay vì daemon | Đơn giản, ít moving parts; OS đã có file lock primitive. |
| 1 state file thay vì nhiều file per session | Atomicity dễ hơn, list nhanh hơn. |
| Không gửi prompt vào remote session | Mobile/web đã làm; không có API public; out of scope. |
| Không cache state trong RAM | MCP server stateless ⇒ không có cache staleness bug. |
| Detach bằng `detached:true` + `unref()` thay vì daemon manager | Đủ cho mọi OS Node hỗ trợ; tránh phụ thuộc `pm2`/`forever`. |
| `proper-lockfile` thay vì `flock(2)` native | Cross-platform, đã proven. |
| Audit JSONL append-only | Đơn giản, grep-able, không cần parser. |
| Worktree merge-back để user xử lý conflict | Auto-resolve nguy hiểm; v1 chỉ báo lỗi. |

---

## ARCH-17 — Glossary

- **Orchestrator**: Claude Code session đang chạy nơi user gọi tool. Là
  parent gián tiếp của remote child.
- **MCP server**: Process Node chạy stdio MCP, do orchestrator spawn theo
  plugin spec.
- **Remote child / remote session**: Process `claude remote-control` do
  `spawn_remote_session` tạo ra.
- **State file**: `state.json` shared, source of truth cho registry.
- **Session ID**: Định danh ổn định cho 1 remote child, format
  `<hostname>-<adjective>-<noun>`.

---

## Cross-reference cho task files

Khi viết task `tasks/<n>-<slug>.md`, reference ARCH-x.y trong field
"Architecture refs". Ví dụ task file đầu:

```md
# Task 01 — Bootstrap MCP server skeleton

Architecture refs:
- ARCH-1.1 (high-level diagram)
- ARCH-2 (runtime model)
- ARCH-9.1 (.claude-plugin/plugin.json)
- ARCH-14 (repo layout)
- ARCH-15 (dependencies)

Deliverable:
- .claude-plugin/plugin.json + package.json + tsconfig.json
- src/server.ts boot được, register 1 dummy tool "ping"
- /plugin install local path → gọi được tool ping
```
