---
"@kilocode/kilo-jetbrains": patch
---

Detect a worktree's pull request reliably in Agent Manager. Imported PRs — including PRs from forks — hand-made worktrees, and locally renamed branches now show their PR badge, the current repository row gets one too, and a freshly imported PR no longer waits out the status poll. Imported PR branches also get proper git tracking, so `git push` and `git pull` work in the new worktree.
