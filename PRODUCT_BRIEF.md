# claude-remote-mcp — Product Brief (v2)

## 1. Tóm tắt

`claude-remote-mcp` là một **Claude Code plugin** đóng gói **MCP server** giúp
một Claude Code session đang chạy **spawn và quản lý các Remote Control session
con** trên cùng máy local.

Plugin chỉ phụ trách **bootstrap và local-side operations** — những việc mà
mobile app / `claude.ai/code` **không làm được**. Việc *điều khiển* (chat,
approve tool, theo dõi output) thuộc về mobile/web. Plugin và mobile bổ trợ
nhau, không dẫm chân.

State của các session đã spawn được **persist** vào file, dùng chung giữa các
Claude Code session khác nhau trên cùng máy — nên agent ở session sau vẫn list
/ stop / lấy lại URL của các session đã spawn từ session trước.

Cài đặt một lần bằng `/plugin install`, dùng được cho cả **Claude Code CLI** và
**Claude Desktop**.

## 2. Phân vai: plugin vs mobile

Plugin chỉ tồn tại vì có những thứ mobile không làm được. Bảng phân vai:

| Tác vụ | Mobile / claude.ai/code | Plugin (local-side) |
| --- | --- | --- |
| Chat với session, gửi prompt, duyệt tool call | ✅ | ❌ (không làm và không cần làm) |
| Xem list session online + status | ✅ | ✅ (đọc state file, biết cả pid local) |
| Spawn `claude remote-control` ở folder mới | ❌ | ✅ |
| `mkdir`, tạo git worktree, copy `.env` | ❌ | ✅ |
| `/plugin install` (local-only theo docs) | ❌ | ✅ |
| `/mcp` add server (local-only) | ❌ | ✅ |
| Kill orphan process, cleanup TTL | ❌ | ✅ |
| Merge commits từ worktree con về branch chính | ❌ | ✅ |
| Pre-flight check version/auth/org policy | ❌ | ✅ |

## 3. Nguyên tắc thiết kế

1. **Bootstrap-only, không steering.** Sau khi spawn xong và trả URL, plugin
   coi như đã hoàn thành nhiệm vụ chính. User chuyển sang mobile/web.
2. **Cross-session state.** Mọi Claude Code session trên cùng máy đều thấy
   chung 1 registry. Đóng terminal, mở lại, vẫn list được session đã spawn
   sáng nay.
3. **Detach đúng.** Process con phải sống được khi parent (Claude Code session
   spawn ra nó + MCP server đi kèm) chết.
4. **Idempotent + typed I/O.** Tool trả JSON có schema rõ để agent chain với
   tool khác (vd: spawn → share link qua Channels).
5. **Không reinvent UI.** Không build dashboard, không hiển thị transcript. UI
   = `claude.ai/code`.

## 4. Mục tiêu v1

- **G1 — Spawn**: `spawn_remote_session(folder, ...)` trả URL trong < 10s, ghi
  vào state file. Detach process đúng để con sống sau khi parent chết.
- **G2 — Cross-session lifecycle**: `list_remote_sessions`, `stop_remote_session`,
  `get_session_link` đọc/ghi state file, dùng được từ bất kỳ Claude Code
  session nào trên cùng máy.
- **G3 — Plugin / MCP bootstrap**: `install_plugin` và `install_mcp_server` —
  bù đắp việc `/plugin` và `/mcp` là local-only.
- **G4 — Worktree workflow**: spawn vào git worktree + `merge_back_session` để
  bring commits con về branch chính.
- **G5 — Pre-flight**: `check_remote_ready()` trả về JSON tất cả prerequisite.

### Non-goals (v1)

- Không gửi prompt vào remote session (mobile/web làm).
- Không đọc transcript của remote session (mobile/web hiển thị).
- Không hỗ trợ session ở máy khác (chỉ local).
- Không tự authenticate hộ user.
- Không UI dashboard riêng.

## 5. Personas & use cases

### UC1 — Fan-out morning routine

10h sáng, ở máy bàn (Claude Code session A):

> *spawn 3 remote session: `migrations` chạy alembic upgrade, `testing` chạy
> test suite full, `docs` regenerate API docs*

Plugin tạo 3 folder/worktree, spawn 3 remote, trả 3 URL. User đi họp, mở mobile
theo dõi cả 3.

### UC2 — Recover after closing terminal

8h tối, Claude Code session B mới (terminal khác):

> *list các remote session tôi đang có*

`list_remote_sessions` đọc state file, thấy 3 session từ sáng (verify PID
alive), trả về. Agent tóm tắt cho user. User chọn stop 2 cái, giữ 1.

### UC3 — Bootstrap repo mới clone

User vừa clone repo, vào Claude Code:

> *cài plugin `security-review` và MCP server `linear`*

`install_plugin` + `install_mcp_server` chạy local CLI, xong. Không cần thoát
ra terminal gõ tay.

### UC4 — Merge worktree branch về main

Sau khi session "auth-refactor" trên mobile xong:

> *merge session `auth-refactor` về branch `main` theo strategy squash*

`merge_back_session` kiểm tra worktree, rebase/squash commits của con vào main,
xoá worktree nếu user muốn.

## 6. MCP tools

### 6.1 `spawn_remote_session`

| Field | Type | Required | Mô tả |
| --- | --- | --- | --- |
| `folder` | string | yes | Tuyệt đối hoặc tương đối. Auto `mkdir -p`. |
| `name` | string | no | Truyền `--name`. Nếu thiếu, plugin auto-gen. |
| `spawn_mode` | enum | no | `same-dir` \| `worktree` \| `session`. Default `same-dir`. |
| `worktree_branch` | string | no | Khi `spawn_mode=worktree`. Default `claude/<name>`. |
| `sandbox` | bool | no | Truyền `--sandbox`. |
| `initial_prompt` | string | no | Prompt khởi tạo qua `claude --remote-control "<prompt>"` thay vì server mode. |
| `tags` | string[] | no | Lưu vào state để filter sau. |

**Output**

```json
{
  "session_id": "myhost-graceful-unicorn",
  "name": "migrations",
  "url": "https://claude.ai/code/...",
  "qr_ascii": "...",
  "pid": 12345,
  "working_dir": "/abs/path",
  "spawn_mode": "worktree",
  "worktree_branch": "claude/migrations",
  "started_at": "2026-05-15T10:00:00Z",
  "tags": ["morning-fanout"]
}
```

**Hành vi**

- `setsid` (Unix) / `detached: true` + `unref()` (Windows) để con sống độc lập.
- Tail stdout đến khi match regex URL, timeout 30s.
- Append vào `~/.claude-remote-mcp/state.json` (atomic write + file lock).
- Nếu folder chưa workspace-trusted, fail sớm với code `WORKSPACE_NOT_TRUSTED`
  và hướng dẫn user trust 1 lần thủ công.

### 6.2 `list_remote_sessions`

| Field | Type | Mô tả |
| --- | --- | --- |
| `filter_tags` | string[] | optional |
| `only_alive` | bool | default `true`, verify pid alive |

**Output**: array các entry như `spawn` trả về, kèm `status: alive | dead`.

Mỗi lần gọi, plugin reconcile state file với reality (pid còn sống không) và
ghi lại.

### 6.3 `stop_remote_session`

Input: `session_id` hoặc `pid`.
Hành vi: SIGTERM, đợi 5s, fallback SIGKILL. Cập nhật state.

### 6.4 `get_session_link`

Input: `session_id`. Trả lại URL + QR. Cho trường hợp user mất tin nhắn cũ
trong session orchestrator.

### 6.5 `install_plugin`

| Field | Type | Required | Mô tả |
| --- | --- | --- | --- |
| `plugin` | string | yes | Tên hoặc marketplace ref. |
| `scope` | enum | no | `user` \| `project` \| `local`. Default `project`. |
| `marketplace` | string | no | URL/alias marketplace. |

Wrap `claude plugin install`. Đặc biệt giá trị vì `/plugin` là local-only trên
mobile — đây là đường duy nhất để cài plugin từ xa (qua mobile lái orchestrator
ở nhà).

### 6.6 `install_mcp_server`

| Field | Type | Required | Mô tả |
| --- | --- | --- | --- |
| `name` | string | yes | Tên server. |
| `command` | string | yes | Lệnh chạy (`npx`, `node`, ...). |
| `args` | string[] | no | |
| `env` | object | no | Env vars (cảnh báo khi có key trông như secret). |
| `scope` | enum | no | `user` \| `project` \| `local`. |

Wrap `claude mcp add`. Cùng lý do với `install_plugin`: `/mcp` local-only.

### 6.7 `merge_back_session`

| Field | Type | Required | Mô tả |
| --- | --- | --- | --- |
| `session_id` | string | yes | Phải là session spawn ở `worktree` mode. |
| `target_branch` | string | yes | Branch đích, vd `main`. |
| `strategy` | enum | no | `merge` \| `rebase` \| `squash`. Default `rebase`. |
| `remove_worktree` | bool | no | Default `true` nếu thành công. |

Stop session nếu còn alive, fetch commits từ worktree, áp dụng strategy, xoá
worktree. Trả về JSON tóm tắt commits đã merge.

### 6.8 `check_remote_ready`

Input: rỗng.

**Output**

```json
{
  "ok": false,
  "checks": {
    "claude_version": { "ok": true, "value": "2.1.110" },
    "claude_min": { "ok": true, "required": "2.1.51" },
    "authenticated": { "ok": true, "method": "claude.ai" },
    "org_remote_control_enabled": { "ok": false, "reason": "ADMIN_TOGGLE_OFF" },
    "workspace_trusted": { "ok": true, "folder": "/abs/path" },
    "port_443_reachable": { "ok": true }
  },
  "blocking": ["org_remote_control_enabled"]
}
```

Agent gọi cái này *trước* mọi spawn lần đầu để cho user message rõ ràng thay
vì fail giữa đường.

## 7. Kiến trúc

```
~/.claude-remote-mcp/
  state.json       ← shared registry, file-locked
  audit.log        ← JSONL, append-only
  logs/<sid>.log   ← stdout của từng remote child

┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│ Claude Code session A (term 1)  │    │ Claude Code session B (term 2)  │
│  ├── MCP client                 │    │  ├── MCP client                 │
│  └── MCP server (per-process)   │    │  └── MCP server (per-process)   │
└──────────┬──────────────────────┘    └──────────┬──────────────────────┘
           │                                      │
           └──────── đều đọc/ghi ────────────────┘
                          │
                          ▼
                  state.json (file lock)
                          │
                          ▼
              spawn / list / stop
                          │
                          ▼
        ┌───────────────────────────┐
        │ claude remote-control     │  detached (setsid + nohup)
        │ (child trong target dir)  │  sống độc lập với parent
        └───────────────────────────┘
```

Điểm chính:

- **Mỗi Claude Code session có MCP server riêng** (chuẩn của plugin spec).
- **State chung** qua file lock — không cần daemon. Đơn giản, ít moving parts.
- **Race condition**: dùng `proper-lockfile` (Node) hoặc tương đương; mọi
  mutation đều read-modify-write trong lock.
- **Detached child**: dùng `child_process.spawn` với `detached: true`,
  `stdio: ['ignore', fd_logfile, fd_logfile]`, gọi `subprocess.unref()`.
- **PID verification**: `process.kill(pid, 0)` để check alive mà không kill.

### Layout repo

```
claude-remote-mcp/
├── .claude-plugin/
│   ├── plugin.json          # plugin manifest
│   └── marketplace.json     # single-plugin marketplace catalog
├── commands/                # slash commands (auto-discovered at plugin root)
├── dist/
│   └── server.js            # esbuild bundle (committed, no deps needed)
├── package.json
├── src/
│   ├── server.ts             # MCP server entry
│   ├── tools/
│   │   ├── spawnRemote.ts
│   │   ├── listSessions.ts
│   │   ├── stopSession.ts
│   │   ├── getSessionLink.ts
│   │   ├── installPlugin.ts
│   │   ├── installMcpServer.ts
│   │   ├── mergeBackSession.ts
│   │   └── checkRemoteReady.ts
│   ├── registry.ts           # state.json IO với file lock
│   ├── claudeCli.ts          # wrapper quanh `claude` binary
│   ├── audit.ts              # append-only JSONL
│   └── platform.ts           # cross-platform detach helpers
├── README.md
└── PRODUCT_BRIEF.md
```

`.claude-plugin/plugin.json` đăng ký 1 MCP server. Claude Code auto-discover
folder `commands/` ở plugin root — không cần list file trong manifest. Slash
command bị namespace theo tên plugin:

- `/claude-remote-mcp:spawn-remote <folder>` → `spawn_remote_session`
- `/claude-remote-mcp:list-remote` → `list_remote_sessions`
- `/claude-remote-mcp:stop-remote <id>` → `stop_remote_session`

Slash command chỉ là syntactic sugar; agent vẫn có thể gọi tool trực tiếp.

## 8. Phân phối

- Giai đoạn dev: cài qua local path hoặc git URL.
- Sau v1 ổn định: `claude plugin publish` lên marketplace.
- Yêu cầu Claude Code **>= 2.1.51** (Remote Control requirement). Check lúc
  cài và tại runtime.

## 9. Yêu cầu kỹ thuật

- Node **>= 20** (native fetch, `child_process` API mới).
- Plan Pro/Max OK. Team/Enterprise cần admin bật toggle Remote Control.
- Không hỗ trợ API key auth.
- Không mở inbound port; outbound HTTPS qua `claude remote-control`.

## 10. Rủi ro & câu hỏi mở

1. **Parse URL từ stdout `claude remote-control`** version-dependent. Cần
   snapshot test + regex fallback.
2. **Detached process cross-platform**: Linux/macOS dùng `setsid`, Windows
   dùng `detached: true` + `unref()`. Cần verify trên cả 3.
3. **Workspace trust dialog** chặn spawn lần đầu vào folder mới. Hiện chưa có
   flag `--trust` công khai; v1 sẽ fail rõ ràng và bảo user trust thủ công 1
   lần.
4. **State file corruption** nếu crash giữa lúc write. Mitigate: write tới
   `state.json.tmp` rồi atomic rename.
5. **`initial_prompt`** dựa vào việc `claude --remote-control "<prompt>"` chấp
   nhận prompt khởi tạo. Cần xác nhận; nếu không, fallback là spawn server mode
   không prompt.
6. **`merge_back_session` an toàn**: rebase có conflict thì sao? v1 dừng và
   báo lỗi structured, để user xử lý tay; không tự auto-resolve.
7. **Khi user dùng ultraplan**, Remote Control của session đang dùng plugin sẽ
   bị disconnect. Cần document rõ.

## 11. Milestones

| M | Nội dung | Done khi |
| --- | --- | --- |
| M0 | Skeleton plugin + MCP server + `check_remote_ready` | `/plugin install` xong, `check_remote_ready` chạy được trên Linux/macOS/Windows |
| M1 | `spawn_remote_session` + state.json + detach đúng | Spawn xong, đóng Claude Code session parent, child vẫn online trên claude.ai/code |
| M2 | `list` / `stop` / `get_session_link` với file lock | Race test 10 parallel writes không corrupt state |
| M3 | `install_plugin` + `install_mcp_server` | Cài thật 1 plugin và 1 MCP server qua tool |
| M4 | Worktree mode + `merge_back_session` | Spawn worktree → commit ở mobile → merge_back về main thành công |
| M5 | Marketplace release | Plugin public, README, demo video |

## 12. Metrics thành công

- **Time-to-URL**: spawn → URL hiện ra **< 10s** ở máy thông thường, p95.
- **Detach reliability**: 100% child sống sau khi kill parent, trên 3 OS.
- **State consistency**: 0 corruption qua 1000 lần race test.
- **Adoption**: 100 install marketplace trong tháng đầu sau release.

## 13. Out of scope, future

- `wait_for_remote_session` + fan-out automation cho CI / no-human-in-loop.
- Session profile `.claude-remote.yaml` declarative spawn.
- `share_session` tích hợp Channels (Slack/Telegram/iMessage).
- `get_session_usage` — token + cost per session.
- TTL auto-cleanup + `onSpawn` / `onComplete` hooks shell.
- Spawn remote session trên máy khác (cần control plane riêng).
- Web dashboard tổng hợp cross-machine.
