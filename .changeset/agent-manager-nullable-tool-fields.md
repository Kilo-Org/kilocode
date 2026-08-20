---
"@kilocode/cli": patch
---

Fix Agent Manager ignoring requests to start new sessions on OpenAI Responses API models, where a start request was answered with a list of existing sessions instead of creating the worktree or session.
