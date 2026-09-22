---
"@kilocode/cli": patch
---

Fix provider initialization failing with an HTTP 500 when `enabled_providers` excludes Kilo while a Kilo login is stored. Excluded providers are now skipped before their auth loader runs.
