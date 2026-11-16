---
"@kilocode/cli": patch
---

Codebase indexing no longer drops a whole embedding batch when the provider rejects one oversized chunk. Rejected batches (HTTP 400, 413, 422) are not retried, they are split until the offending chunk is isolated, and each skipped chunk is reported with its file and line range.
