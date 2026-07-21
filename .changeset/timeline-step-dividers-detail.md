---
"kilo-code": minor
"@kilocode/cli": patch
---

Add step dividers to the session activity timeline and update timeline interactions so left-click opens a bar action menu while right-click preserves jump-to-part behavior.

Add a step-level details dialog from timeline actions that shows agent/provider/model, started/finished timestamps, duration, total cost, token usage, cache read/write, and cache hit rate.

Add i18n coverage for all new timeline and step-details user-facing text across supported locales.

The CLI now records authoritative `time` (start/end) on `step-start` and `step-finish` parts.
