---
"kilo-code": patch
---

Keep pre-warmed Agent Manager worktrees outside the project folder, so build tools, test runners, and file watchers that scan the project no longer find an extra checkout in `.kilo/worktrees/`. Pre-warmed worktrees left in `.kilo/worktrees/` by earlier versions are removed automatically.
