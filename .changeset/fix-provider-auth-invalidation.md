---
"@kilocode/cli": patch
"kilo-code": patch
---

Fixed default model falling back to the free model after login or org switch by invalidating cached provider state when auth changes.
