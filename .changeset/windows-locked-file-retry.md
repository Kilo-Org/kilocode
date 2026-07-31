---
"@kilocode/cli": patch
---

Retry transient locked-file errors (EPERM/EACCES/EBUSY) on Windows when atomically saving config and other files. Background plugin installs and Windows Defender/indexer can briefly hold the temp file during the rename step, which previously surfaced as a 500 error. A short backoff now retries the rename so config writes succeed without surfacing the contention.
