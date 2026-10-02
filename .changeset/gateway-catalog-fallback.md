---
"@kilocode/kilo-gateway": patch
"@kilocode/cli": patch
---

Keep the last known Kilo model catalog and retry with backoff when a catalog fetch fails, so a transient network error no longer breaks every Kilo model
