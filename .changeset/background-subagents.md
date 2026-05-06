---
"@kilocode/cli": minor
---

Allow TUI agents to run subagents in the background and notify the parent session when they finish.

**Experimental feature** — must be opted in via config:

```json
{ "experimental": { "background_subagents": true } }
```

When the flag is not set, `background: true` in the task tool behaves as `background: false` (foreground). `kilo run` always runs tasks in foreground regardless of this flag, because it exits when the session becomes idle and background fibers would be lost.

When the parent session is aborted, all live background child sessions are cancelled automatically.

**Known limitation**: when a background child needs a permission approval, the TUI shows the dialog but may require the user to navigate to the child session if they have moved away from the parent.
