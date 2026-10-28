---
"@kilocode/cli": patch
---

Fire each scheduled wakeup and cron task once when several Kilo processes open the same workspace, and keep a cancelled task from firing or coming back in another process.
