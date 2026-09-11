---
"kilo-code": minor
---

Speed up Agent Manager worktree creation by pre-warming reusable worktrees and claiming a ready one instead of running a full checkout. Control the pre-warming in Agent Manager settings under "Pre-warm worktrees"; it is enabled by default and uses one extra checkout of disk space per open project.
