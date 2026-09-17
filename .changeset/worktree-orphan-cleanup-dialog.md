---
"kilo-code": minor
"@kilocode/kilo-jetbrains": minor
---

Leftover worktree folders now show a count and total size in the warning banner, with a "Resolve…" action that opens a dialog listing each folder's path, size, and whether it still holds a git checkout. While the total is still being measured the banner says so, and if the measurement fails it reports the count alone instead of claiming 0 B. The dialog's explanation starts collapsed to its first paragraph behind a "Show more" link, and its checkboxes are drawn the way each IDE draws its own. Deletion runs in the background so the UI never freezes, folders that still contain a checkout are unchecked by default, and a completion notification reports how many were removed. Worktree deletion is also more thorough: JetBrains now tears down backend state and removes the snapshot repository for a deleted worktree the same way VS Code already does, and a directory that reappears immediately after deletion is cleaned up once more automatically.
