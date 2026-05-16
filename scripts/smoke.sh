#!/usr/bin/env bash
set -euo pipefail

# End-to-end smoke test that runs the MCP server over stdio and exercises
# the read-only tools (list_remote_sessions, check_remote_ready). Spawning a
# real remote session is not done here — use the vitest integration suite
# (test/integration/spawn.test.ts) for that, which uses a fake `claude`
# binary.

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build >/dev/null

SMOKE_HOME="$(mktemp -d -t crm-smoke.XXXXXX)"
trap 'rm -rf "$SMOKE_HOME"' EXIT

CLAUDE_REMOTE_MCP_HOME="$SMOKE_HOME" \
CLAUDE_REMOTE_MCP_VERBOSE=true \
node dist/server.js <<EOF
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_remote_ready","arguments":{}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_remote_sessions","arguments":{}}}
EOF
