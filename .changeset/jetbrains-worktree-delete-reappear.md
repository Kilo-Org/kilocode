---
"@kilocode/kilo-jetbrains": patch
---

Fix the Agent Manager panel showing a deleted worktree again after switching tabs when the git removal did not actually succeed. Locked worktrees are now marked in the list, the delete dialog asks for explicit confirmation before force-removing a locked worktree, and a failed deletion shows a notification with a one-click force-delete retry.
