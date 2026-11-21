---
"@kilocode/kilo-jetbrains": patch
---

Keep Agent Manager working when a worktree listing repeats the primary checkout. Previously the duplicate row could crash the list with "ActiveTree keys must be unique" during a refresh or worktree delete.
