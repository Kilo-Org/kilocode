---
"@kilocode/cli": patch
---

Skip the redundant bash/external-directory approval prompt for commands that run inside the enabled sandbox — the sandbox already confines them, so only mutating Git commands that escape the sandbox still ask for confirmation. The interactive TUI no longer hangs when such a Git confirmation is needed while auto-approve is on.
