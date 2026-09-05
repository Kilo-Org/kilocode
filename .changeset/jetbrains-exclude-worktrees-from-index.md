---
"@kilocode/kilo-jetbrains": minor
---

Exclude Kilo-managed agent worktrees from the containing project's index, so a large `.kilo/worktrees` checkout no longer doubles indexing time or shows duplicate results in Search Everywhere. Toggle "Index agent worktrees" in Kilo Settings → Advanced to opt back in. Opening a worktree as its own project still indexes it fully.
