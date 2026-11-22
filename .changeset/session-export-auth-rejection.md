---
"@kilocode/cli": patch
---

Stop retrying session-export uploads when the ingest endpoint rejects the credential, keeping the pending rows instead of resending them.
