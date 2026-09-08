---
"@kilocode/kilo-jetbrains": patch
---

Mark worktrees whose pull request no longer merges into its base branch. The changes-vs-base badge gets a red circle behind its trailing edge and its tooltip leads with the conflict, in the Agent Manager list, the worktree session header, and the chat PR header. The row hover popup adds a line for it that opens the pull request. Read from GitHub alongside the review and CI verdicts, so no extra `gh` call.
