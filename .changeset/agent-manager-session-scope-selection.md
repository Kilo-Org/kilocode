---
"kilo-code": minor
---

Make the Agent Manager diff review follow the sidebar selection instead of a single session. Switching session tabs inside a worktree no longer refetches the Branch, Staged, and Unstaged scopes, the Session scope now swaps to the active session's changes on tab switch, and the Local tab gains the Session scope so sessions running in the workspace can be reviewed on their own. The Session scope shows a notice when snapshots are disabled instead of a blank list, worktrees without an open session now still show their branch diff, and the Apply dialog lists the worktree's changes again.
