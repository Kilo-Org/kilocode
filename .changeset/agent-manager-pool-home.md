---
"kilo-code": patch
---

Keep pre-warmed Agent Manager worktrees outside the project folder. `.kilo/worktrees/` is now only created when you create a worktree, so build tools, test runners, and file watchers that scan the project no longer find an extra checkout. Pre-warmed worktrees left in `.kilo/worktrees/` by earlier versions are removed automatically. Projects on a different drive than your home folder are no longer pre-warmed.
