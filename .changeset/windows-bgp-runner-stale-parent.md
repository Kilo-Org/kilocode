---
"@kilocode/cli": patch
---

Fix Windows background jobs staying active after their command finishes or treating unrelated programs as part of the job. If a job cannot be stopped safely, the stop request fails with an error and the job output says why.
