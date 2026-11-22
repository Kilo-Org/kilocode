---
"@kilocode/cli": patch
---

Pause session-export uploads when the ingest endpoint rejects the credential, keep the captured batches pending, and report the rejection and its release through telemetry.
