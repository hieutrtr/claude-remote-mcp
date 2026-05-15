# claude-remote-mcp — Product Brief

## 1. Tóm tắt

`claude-remote-mcp` là một **Claude Code plugin** đóng gói một **MCP server** cho
phép một session Claude Code đang chạy **tự spawn các session Claude Remote
Control con** trong các thư mục mới, rồi **trả link session về cho session
gốc** để người dùng có thể tiếp tục công việc từ điện thoại / trình duyệt khác.

Plugin cũng phơi ra các tool để **cài thêm plugin khác vào repo hiện tại** một
cách lập trình, biến session gốc thành một "orchestrator" có khả năng tự bootstrap
môi trường làm việc.

Cài đặt một lần, dùng được cho cả **Claude Code CLI** và **Claude Desktop** qua
cơ chế plugin chuẩn.

## 2. Bối cảnh & vấn đề

Quy trình tạo remote session hiện tại đòi hỏi thao tác thủ công:

1. Mở terminal mới.
2. `mkdir` và `cd` vào folder mong muốn.
3. Chạy `claude remote-control --name ...`.
4. Copy URL hoặc scan QR thủ công.
5. Mở URL ở thiết bị khác.

Khi đang ở giữa một task phức tạp, người dùng thường muốn:

- Spawn nhiều sub-task chạy song song trong các worktree / folder khác nhau.
- Bắt đầu một task ở máy bàn rồi đi ra ngoài tiếp tục trên điện thoại.
- Để chính Claude tự quyết định khi nào nên fork ra một remote session mới
  (ví dụ: chạy migration dài, code review song song, v.v.).

Hiện chưa có cách lập trình nào để **agent tự tạo remote session** từ trong
hội thoại.

## 3. Mục tiêu (v1)

- **G1 — Spawn remote session bằng tool call**: từ một câu lệnh tự nhiên trong
  Claude Code, tool `spawn_remote_session` tạo folder (nếu chưa có), khởi động
  `claude remote-control` ở chế độ detached, parse URL và trả về session gốc.
- **G2 — Plugin một lệnh cài**: `/plugin install claude-remote-mcp` hoạt động
  cả trong Claude Code CLI và Desktop, không cần thao tác thủ công thêm.
- **G3 — Tool cài thêm plugin khác**: `install_plugin` cho phép orchestrator
  bootstrap repo với các plugin phụ thuộc (testing helpers, linters, v.v.) mà
  không cần user thoát ra chạy `/plugin install` từng cái.
- **G4 — Quản lý vòng đời session**: list, stop, rename các session đã spawn.

### Non-goals (v1)

- Không host bất kỳ thứ gì ở cloud — toàn bộ session vẫn chạy local, đúng
  semantic của Remote Control.
- Không tự authenticate hộ user — kế thừa login state của `claude` CLI hiện tại.
- Không cung cấp UI dashboard riêng; session list dùng lại `claude.ai/code`.
- Không thay thế `claude --remote-control` / `/remote-control` cho session
  *hiện tại* — chỉ spawn session *con*.

## 4. Personas & use cases

| Persona | Use case |
| --- | --- |
| Solo developer | Đang code trong terminal, bảo Claude "spawn 1 remote session cho task migration ở folder `migrations/`, gửi link về cho tôi" → mở link trên iPad theo dõi. |
| Tech lead | Trong khi review PR, bảo Claude tạo 3 worktree song song để chạy 3 hướng fix khác nhau, mỗi worktree là 1 remote session riêng. |
| Repo maintainer | Mới clone repo, bảo Claude "cài plugin testing-helpers và security-review", plugin tự gọi `install_plugin` thay user. |

## 5. Phạm vi & các MCP tool

### 5.1 `spawn_remote_session`

Tạo folder (nếu cần) và khởi động `claude remote-control` detached, parse URL
và trả về.

**Input**

| Field | Type | Required | Mô tả |
| --- | --- | --- | --- |
| `folder` | string | yes | Đường dẫn tuyệt đối hoặc tương đối so với cwd. Tự `mkdir -p`. |
| `name` | string | no | Tên session, truyền `--name`. |
| `spawn_mode` | enum | no | `same-dir` \| `worktree` \| `session`. Truyền `--spawn`. Mặc định `same-dir`. |
| `capacity` | int | no | Truyền `--capacity`. |
| `sandbox` | bool | no | Bật `--sandbox` / `--no-sandbox`. |
| `initial_prompt` | string | no | Nếu có, gửi prompt khởi tạo vào session vừa spawn (qua stdin / API tương thích). |

**Output**

```json
{
  "session_id": "myhost-graceful-unicorn",
  "name": "migrations",
  "url": "https://claude.ai/code/...",
  "qr_ascii": "...",
  "pid": 12345,
  "working_dir": "/abs/path",
  "started_at": "2026-05-15T10:00:00Z"
}
```

**Hành vi quan trọng**

- Detach process (double-fork hoặc `setsid` + `nohup`) để session không die khi
  MCP server restart.
- Tail stdout đến khi match regex URL hoặc timeout 30s.
- Ghi nhận pid + metadata vào state file `~/.claude-remote-mcp/state.json`.
- Nếu `claude --version` < `2.1.51`, fail sớm với message rõ ràng.

### 5.2 `install_plugin`

Cài plugin vào repo / scope hiện tại.

**Input**

| Field | Type | Required | Mô tả |
| --- | --- | --- | --- |
| `plugin` | string | yes | Tên plugin hoặc marketplace ref (`owner/name@version`). |
| `scope` | enum | no | `user` \| `project` \| `local`. Mặc định `project`. |
| `marketplace` | string | no | URL/alias marketplace nếu khác mặc định. |

**Output**: `{ installed: true, plugin, scope, version }` hoặc lỗi structured.

**Hành vi**: shell ra `claude plugin install ...`, capture stdout/stderr, parse
kết quả. Tôn trọng workspace trust — nếu chưa trust thì trả về error code
`WORKSPACE_NOT_TRUSTED` để agent gốc xử lý.

### 5.3 `list_remote_sessions`

Liệt kê các session đã spawn còn sống. Đọc state file + verify pid còn alive.

### 5.4 `stop_remote_session`

Input: `session_id` hoặc `pid`. Gửi SIGTERM, fallback SIGKILL sau 5s.

### 5.5 `get_session_link`

Lấy lại URL/QR của một session đã spawn (cho trường hợp user mất tin nhắn cũ).

## 6. Kiến trúc

```
┌──────────────────────────────────────────────┐
│ Claude Code session (CLI / Desktop)          │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ MCP client                             │  │
│  └──────────────┬─────────────────────────┘  │
└─────────────────┼────────────────────────────┘
                  │ stdio
                  ▼
        ┌──────────────────────┐
        │ claude-remote-mcp    │  Node 20+ / TS
        │  - tools             │
        │  - process registry  │
        │  - state.json        │
        └──────────┬───────────┘
                   │ spawn (detached)
                   ▼
        ┌──────────────────────┐
        │ claude remote-control│  child process
        │  (in target folder)  │
        └──────────┬───────────┘
                   │ outbound HTTPS
                   ▼
              Anthropic API
                   │
                   ▼
          claude.ai/code / mobile
```

**Process registry**

- In-memory map `session_id → { pid, url, folder, name, started_at }`.
- Persist sang `~/.claude-remote-mcp/state.json` sau mỗi mutation.
- Khi MCP server boot, load state và kiểm tra pid nào còn alive (giữ lại) / die (drop).

**Phân quyền**

- Tool đụng tới filesystem (mkdir) và process spawn ⇒ khai báo rõ trong manifest
  để Claude Code prompt approve lần đầu, sau đó user có thể allowlist.

## 7. Phân phối plugin

Thư mục repo:

```
claude-remote-mcp/
├── plugin.json              # Claude Code plugin manifest
├── package.json             # Node project
├── src/
│   ├── server.ts            # MCP server entrypoint
│   ├── tools/
│   │   ├── spawnRemote.ts
│   │   ├── installPlugin.ts
│   │   ├── listSessions.ts
│   │   └── stopSession.ts
│   ├── registry.ts          # state.json IO
│   └── claudeCli.ts         # wrapper quanh `claude` binary
├── README.md
└── PRODUCT_BRIEF.md
```

`plugin.json` đăng ký:

- 1 MCP server `claude-remote-mcp` (command: `node`, args: `[server.js]`).
- Slash command alias gợi ý: `/spawn-remote <folder>` mapping sang tool
  `spawn_remote_session`.

Phân phối qua marketplace (`claude plugin publish`) sau khi v1 ổn định. Trong
giai đoạn dev: cài qua local path / git URL.

## 8. Yêu cầu kỹ thuật & ràng buộc

- Claude Code **>= 2.1.51** (yêu cầu của Remote Control). Check tại runtime.
- Auth: dùng lại login của `claude` CLI; không hỗ trợ API key (đúng theo giới
  hạn của Remote Control).
- Plan: Pro/Max OK; Team/Enterprise cần admin bật toggle Remote Control.
- Node **>= 20** (để dùng `node:child_process` detached + native fetch).
- Không mở inbound port; chỉ outbound HTTPS (đã được `claude remote-control`
  lo).

## 9. Rủi ro & câu hỏi mở

1. **Parsing URL từ stdout của `claude remote-control`** phụ thuộc vào format
   output — cần snapshot test theo version và có fallback regex.
2. **Detached process lifecycle**: nếu MCP server bị Claude Code kill, các
   child có sống tiếp không? Cần verify với `setsid` trên Linux/macOS và
   `detached: true` + `unref()` trên Windows.
3. **`initial_prompt` injection**: chưa rõ `claude remote-control` (server
   mode) có API gửi prompt khởi tạo không — có thể phải dùng `claude
   --remote-control "<prompt>"` thay vì server mode cho use case này.
4. **Workspace trust** cho folder mới tạo: lần đầu spawn vào folder lạ, child
   process sẽ bị block bởi trust dialog. Cần option `--trust` hoặc hướng dẫn
   user.
5. **Ultraplan conflict**: doc nói ultraplan disconnect Remote Control —
   document rõ trade-off này cho user.
6. **Race condition khi nhiều tool spawn cùng lúc**: serialize ghi
   `state.json` (file lock) hoặc dùng append-only log.

## 10. Milestones

| M | Nội dung | Tiêu chí done |
| --- | --- | --- |
| M0 | Skeleton plugin + MCP server boot, ping tool | `/plugin install` xong, gọi được tool dummy từ Claude Code |
| M1 | `spawn_remote_session` end-to-end | Spawn được, parse URL, trả về URL hoạt động trên claude.ai/code |
| M2 | `install_plugin` + version check | Cài được 1 plugin thật từ marketplace qua tool |
| M3 | State persistence + `list` / `stop` / `get_session_link` | Restart MCP server không mất tracking |
| M4 | Cross-platform polish (Linux/macOS/Windows) + sandbox flag | CI matrix pass |
| M5 | Marketplace release + docs | Plugin public, có README + demo video |

## 11. Metrics thành công

- Time-to-remote-session: từ lúc user nói "spawn 1 session" → URL hiện ra
  **< 10 giây** ở máy thông thường.
- Reliability: **>= 95%** spawn calls trả URL trong vòng timeout, đo qua 100
  lần liên tiếp ở internal testing.
- Adoption: 100 install marketplace trong tháng đầu sau release.

## 12. Out of scope, future ideas

- Spawn remote session trên **máy khác** (cần một control plane). v1 chỉ
  local.
- Tích hợp với **Channels** / **Dispatch** để bắc cầu sang Slack / Telegram.
- Templated bootstrap: `spawn_remote_session` kèm preset (folder layout +
  plugins + initial prompt) — kiểu `create-react-app` cho Claude session.
- Web dashboard hiển thị tất cả session đã spawn của user (qua API riêng).
