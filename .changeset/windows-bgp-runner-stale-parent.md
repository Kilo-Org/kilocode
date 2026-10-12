---
"@kilocode/cli": patch
---

Fix Windows background jobs staying active after their command finishes or treating unrelated programs as part of the job. If a job cannot be stopped safely, Kilo reports the failure instead of silently treating it as stopped.
