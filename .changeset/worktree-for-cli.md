---
"@kilocode/cli": minor
---

Add `kilo --worktree <name>` to create (or reuse) a git worktree and start the TUI there. Resuming an explicit `--session <id>` now tries to restart in the worktree the session was originally created in, if it still exists.
