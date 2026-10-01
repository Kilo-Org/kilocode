---
"@kilocode/cli": patch
---

Keep file storage usable after a cancelled operation interrupts its first access. Before, wakeups, cron tasks, and session fork diffs could fail until Kilo restarted.
