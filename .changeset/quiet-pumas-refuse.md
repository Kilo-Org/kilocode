---
"@kilocode/cli": patch
---

Report a content-filtered compaction summary as a content-filter error instead of retrying an empty summary, on both the chunked and the single-request compaction paths.
