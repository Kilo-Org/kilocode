---
"@kilocode/cli": patch
---

Fix pending permission and question prompts disappearing when switching sessions in the TUI.

Viewing another session and returning used to drop the approval popup of a running subagent or session, leaving it blocked forever. Pending asks now survive session switches and are refetched from the server when a session becomes visible, so the prompt can always be answered.
