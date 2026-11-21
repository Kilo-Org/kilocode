---
"@kilocode/cli": patch
---

Fix worktree session list cost growing with every session in the project by deciding directory membership once per distinct directory and keeping the SQL limit.
