---
"@kilocode/cli": patch
---

Fix the Kilo server staying at 100% CPU for many minutes after a large burst of new files in an open workspace, such as a package install in a nested worktree.
