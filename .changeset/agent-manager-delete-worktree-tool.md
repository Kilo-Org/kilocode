---
"kilo-code": minor
---

Add a `delete` action to the `agent_manager` tool so driven agents and orchestration flows can tear down their own Agent Manager worktrees. `delete` removes the worktree card, its `.kilo/worktrees/<name>` directory, and its local branch — mirroring the UI "Delete worktree" button — given a `worktreeID` from `agent_manager` `list`.
