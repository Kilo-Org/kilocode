---
"kilo-code": patch
"@kilocode/cli": patch
---

Fix custom provider model and variant deletions being silently reverted on save. Removing a model or reasoning variant from a custom provider now actually removes it from your config.
