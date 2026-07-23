---
"@kilocode/cli": patch
---

Add a `/auto-approve` slash command in the TUI for toggling auto-approve mode, with aliases `/autoapprove`, `/approve-all`, and `/approveall`. The command dispatches the existing palette entry, so behavior matches the Ctrl+P "Enable/Disable auto-approve mode" toggle.
