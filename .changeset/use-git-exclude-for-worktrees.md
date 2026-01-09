---
"kilo-code": patch
---

Agent Manager: Parallel mode no longer modifies .gitignore

Worktree exclusion rules are now written to `.git/info/exclude` instead, avoiding changes to tracked files in your repository.
