# Task 07 — install_plugin + install_mcp_server

**Milestone**: M3

**Architecture refs**: ARCH-6.5, ARCH-6.6, ARCH-7

## Deliverables

- `src/tools/installPlugin.ts` — wrap `claude plugin install`.
- `src/tools/installMcpServer.ts` — wrap `claude mcp add`, warn về env secret.
- Register trong server.

## Acceptance

- `install_plugin` exec đúng argv với scope flag.
- Output parser bắt được installed version (best-effort).
- `install_mcp_server` cảnh báo khi env key match `/(KEY|TOKEN|SECRET|PASSWORD)/i`.
- Audit `plugin_installed` và `mcp_server_installed`.

## Notes

- `claude` CLI có thể đổi format output — parse defensive, không fail nếu
  không tìm thấy version.
