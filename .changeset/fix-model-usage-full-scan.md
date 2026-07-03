---
"kilo-code": patch
---

Fix slow message loading when opening or switching sessions. The per-model token usage breakdown scanned the entire message history on every session open, which blocked the transcript from rendering for several seconds on large histories.
