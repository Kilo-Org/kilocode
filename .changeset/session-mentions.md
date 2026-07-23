---
"kilo-code": minor
"@kilocode/cli": minor
---

Reference past chats inline with `@` in the prompt. Typing `@` now surfaces a "Past chats" option that opens a searchable picker of previous sessions (scoped to the current workspace/worktree, searched like the Agent Manager session search); selecting one attaches that session's transcript as context so the model can build on a prior conversation. Clicking the mention opens that session. Available in the CLI TUI and the VS Code extension.
