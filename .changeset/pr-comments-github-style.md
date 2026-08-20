---
"kilo-code": minor
---

Rework PR review comments in the Agent Manager PR panel: resolved threads now collapse into one-line rows in a Resolved group instead of being dimmed, each thread shows its replies, and every card has prominent Send to agent, Resolve, Copy, Open file, and Open on GitHub actions. A single button sends all unresolved comments to the agent, and comments arrive as structured review comments instead of pasted text.

Every comment now shows the same amount of code, matching the GitHub snippet and continuing past the commented line with lines from the worktree, so a comment about what happens next is readable. Refreshing the PR no longer closes threads you opened, loses your scroll position, or makes comments disappear.
