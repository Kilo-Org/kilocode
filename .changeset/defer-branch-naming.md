---
"kilo-code": patch
"@kilocode/cli": patch
---

Defer Agent Manager automatic branch naming until the conversation shows a durable task. The first user message no longer renames the branch; naming waits for a second message (up to four) or for the worktree to contain changes, and renames only run while the session is idle. Read-only verification questions (for example "is X fixed?") no longer claim the branch name.
