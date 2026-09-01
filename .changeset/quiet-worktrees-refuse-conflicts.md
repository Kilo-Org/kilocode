---
"@kilocode/kilo-jetbrains": patch
---

Fix moving a session to a worktree so it reliably transfers all changes, including from a repository subdirectory, and clearly explains that unresolved merge conflicts must be resolved first instead of failing with a confusing git error.
