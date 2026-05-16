# Task 01 — Bootstrap MCP server skeleton

**Milestone**: M0

**Architecture refs**: ARCH-1.1, ARCH-2.1, ARCH-9.1, ARCH-14, ARCH-15

## Deliverables

- `package.json` với deps tối thiểu (ARCH-15).
- `tsconfig.json` strict mode, target ES2022, module NodeNext.
- `plugin.json` đăng ký MCP server (ARCH-9.1).
- `src/server.ts` boot được MCP server qua stdio, register 1 tool "ping".
- `src/types.ts` Zod schemas cho ping.
- Build script `npm run build` → `dist/`.
- `dist/server.js` chạy được khi gọi từ Claude Code.

## Acceptance

- `npm install && npm run build` không lỗi.
- `node dist/server.js` không crash khi không có stdio MCP client (chấp nhận
  hang chờ input).
- Smoke test: load qua MCP test harness, gọi tool `ping` → trả `{pong: true}`.

## Notes

- Dùng `@modelcontextprotocol/sdk` >= mới nhất.
- Stdio server, KHÔNG HTTP.
- Type checking pass strict.
