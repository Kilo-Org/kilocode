---
"@kilocode/cli": minor
---

Add `kilo --worktree <name>` to create (or reuse) a git worktree and start the TUI there, placed at `.kilo/worktrees/<name>` alongside worktrees created by the VS Code extension's Agent Manager. Also adds `kilo worktree create/list/remove` for managing worktrees without launching the TUI, and a `/worktree` command in the TUI to list and remove them. Resuming an explicit `--session <id>` now tries to restart in the worktree the session was originally created in, if it still exists.
