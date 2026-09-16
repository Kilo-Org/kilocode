---
"kilo-code": minor
"@kilocode/kilo-jetbrains": minor
---

Leftover worktree folders now show a count and total size in the warning banner, with a "Resolve…" action that opens a dialog listing each folder's path, size, and whether it still holds a git checkout. Deletion runs in the background so the UI never freezes, folders that still contain a checkout are unchecked by default, and a completion notification reports how many were removed. Worktree deletion is also more thorough: JetBrains now tears down backend state and removes the snapshot repository for a deleted worktree the same way VS Code already does, and a directory that reappears immediately after deletion is cleaned up once more automatically.
