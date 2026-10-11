---
"@kilocode/cli": patch
---
Fix permission and question prompts disappearing when switching sessions in the TUI. Approval prompts for running subagents and sessions now persist across session switches and are restored when switching back, so sessions are never left blocked on an unanswered prompt.
