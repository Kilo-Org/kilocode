---
"@kilocode/cli": minor
---

Remote CLI: expose slash command discovery, execution, and `/new` session creation over the relay. `list_commands` and `send_command` (including the built-in `compact` flow) are scoped to the current session's directory. `create_session` creates a root session in that directory, attaches it to the relay heartbeat set, and returns the new session id only after the heartbeat completes so the mobile client can navigate immediately. Failures are sanitized; the command is not auto-retried and the user may retry manually after a transient relay failure.
