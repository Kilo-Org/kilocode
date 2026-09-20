---
"@kilocode/cli": patch
---

Report what `semantic_search` actually covered. It names the indexed root it searched, and an empty result now says whether the index was complete, still building, disabled, or failed, so a miss is no longer mistaken for code that does not exist.
