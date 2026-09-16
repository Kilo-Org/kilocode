---
"kilo-code": patch
"@kilocode/cli": patch
---

Make Agent Manager worktree deletion near-instant in large repositories: the directory is detached without waiting for other git operations, backend cleanup no longer boots an instance for the worktree, and checkpoint cleanup finishes in the background. A worktree whose conversations cannot be re-homed is still deleted instead of leaving an undeletable card.
