---
"kilo-code": patch
---

Fix Agent Manager worktree creation failing when a pooled worktree slot is deleted on disk. The pool now evicts the stale slot and falls back to a normal worktree, and worktree creation failures are written to the Output channel.
