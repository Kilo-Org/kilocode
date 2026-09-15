---
"kilo-code": minor
"@kilocode/kilo-jetbrains": minor
---

Report worktree problems accurately and repair them: stale entries are cleaned up on their own, a deleted worktree can be restored from its branch or removed while keeping its sessions, leftover folders are listed with a cleanup action, and a failed status check now says so instead of showing a worktree as unchanged. Pull request lookups no longer stall on an unresponsive GitHub CLI, a single broken worktree no longer slows down the others, and deleting a worktree while its status is being checked no longer hides review and CI badges on every other worktree until the IDE restarts. The cleanup notice now marks leftover folders that still contain a git checkout and warns that they may hold uncommitted work, and removing a stale worktree entry no longer fails when its terminals cannot be stopped. New "Show Worktree Diagnostics" command in VS Code and "Copy report" action in JetBrains settings.
