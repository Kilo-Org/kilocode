---
"@kilocode/cli": patch
"kilo-code": patch
---

Retry empty model responses three times when they end without a finish reason, while preserving partial responses and preventing unbounded retries.
