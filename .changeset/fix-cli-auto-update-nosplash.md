---
"@kilocode/cli": patch
---

Fix CLI auto-update regression caused by inverted conditional logic with --nosplash flag. The version check now runs for all users by default, regardless of the nosplash flag state.
