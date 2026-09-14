---
"@kilocode/cli": patch
---

Only route auxiliary tasks (session titles, commit messages, branch names) to the cloud kilo-auto/small model when kilo credentials are configured; otherwise fall back to the session's own model so offline and local-only setups keep working.
