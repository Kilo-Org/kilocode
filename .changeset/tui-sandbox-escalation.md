---
"@kilocode/cli": patch
---

Skip the redundant bash/external-directory approval prompt for commands that run inside the enabled sandbox — the sandbox already confines them, so they auto-approve like an allow rule while deny rules and plan-mode hard rules still apply. Only mutating Git commands that escape the sandbox still ask for a one-shot confirmation. The interactive TUI no longer hangs when such a Git confirmation is needed while auto-approve is on.
