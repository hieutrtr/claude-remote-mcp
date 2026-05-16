---
description: Stop a Claude Remote Control session by session_id or pid.
argument-hint: <session_id_or_pid>
---

Call the `stop_remote_session` MCP tool from `claude-remote-mcp`.

Parse `$ARGUMENTS`:

- If the argument is purely numeric, pass it as `pid`.
- Otherwise pass it as `session_id`.

After the tool returns:

- Confirm to the user that the session was stopped (mention the signal that
  finally killed it).
- If the call failed with `SESSION_NOT_FOUND`, suggest `/list-remote --all`
  to inspect the registry.
